import * as path from 'path';
import * as vscode from 'vscode';
import type { Leftover, Severity } from '../model';
import type { LeftoverStore } from '../store';
import { fileSummary, severityRank, totalSummary, worstSeverity } from '../summary';

export const VIEW_ID = 'cleanPush.leftovers';
/** Context key that shows the view; it stays hidden while there are no leftovers. */
const HAS_LEFTOVERS = 'cleanPush.hasLeftovers';
/**
 * File rows use this URI scheme so the decoration provider below can color them without
 * also coloring the same file in the Explorer (that is the separate decorateExplorer feature).
 */
const ROW_SCHEME = 'clean-push-row';
/** Longest line text shown on a leftover row. */
const MAX_SNIPPET = 100;

export interface FileNode {
	kind: 'file';
	uri: vscode.Uri;
	leftovers: Leftover[];
	worst: Severity | undefined;
	relativePath: string;
}

export interface LeftoverNode {
	kind: 'leftover';
	leftover: Leftover;
	parent: FileNode;
}

export type Node = FileNode | LeftoverNode;

const FILE_COLOR: Partial<Record<Severity, string>> = {
	error: 'list.errorForeground',
	warning: 'list.warningForeground',
};

const SEVERITY_ICON: Record<Severity, [string, string]> = {
	error: ['error', 'problemsErrorIcon.foreground'],
	warning: ['warning', 'problemsWarningIcon.foreground'],
	info: ['info', 'problemsInfoIcon.foreground'],
};

/**
 * The Leftovers section in Source Control: one row per file (count, hover summary, Jump
 * button) with its leftovers underneath; clicking a leftover opens the file at that line.
 */
export class LeftoversView implements vscode.TreeDataProvider<Node>, vscode.Disposable {
	private readonly changed = new vscode.EventEmitter<Node | undefined | void>();
	readonly onDidChangeTreeData = this.changed.event;
	readonly treeView: vscode.TreeView<Node>;
	private files: FileNode[] = [];
	private readonly disposables: vscode.Disposable[] = [];

	constructor(private readonly store: LeftoverStore) {
		this.treeView = vscode.window.createTreeView(VIEW_ID, { treeDataProvider: this, showCollapseAll: true });
		this.disposables.push(
			this.treeView,
			this.changed,
			store.onDidChange(() => this.update()),
			vscode.window.registerFileDecorationProvider({ provideFileDecoration: (uri) => rowDecoration(uri) }),
		);
		this.update();
	}

	private update(): void {
		const multiRepo = this.store.repositoryCount > 1;
		this.files = [...this.store.files()]
			.map(([uri, leftovers, root]): FileNode => ({
				kind: 'file',
				uri,
				leftovers: [...leftovers].sort((a, b) => a.range.start.compareTo(b.range.start)),
				worst: worstSeverity(leftovers.map((l) => l.severity)),
				relativePath: repoRelativePath(root, uri, multiRepo),
			}))
			.sort((a, b) => severityRank(a.worst) - severityRank(b.worst) || a.relativePath.localeCompare(b.relativePath));

		const total = this.files.reduce((n, f) => n + f.leftovers.length, 0);
		this.treeView.description = total > 0 ? totalSummary(total, this.files.length) : undefined;
		void vscode.commands.executeCommand('setContext', HAS_LEFTOVERS, total > 0);
		this.changed.fire();
	}

	getChildren(node?: Node): Node[] {
		if (!node) {
			return this.files;
		}
		if (node.kind === 'file') {
			return node.leftovers.map((leftover): LeftoverNode => ({ kind: 'leftover', leftover, parent: node }));
		}
		return [];
	}

	getParent(node: Node): Node | undefined {
		return node.kind === 'leftover' ? node.parent : undefined;
	}

	getTreeItem(node: Node): vscode.TreeItem {
		return node.kind === 'file' ? fileItem(node) : leftoverItem(node.leftover);
	}

	dispose(): void {
		vscode.Disposable.from(...this.disposables).dispose();
	}
}

function fileItem(node: FileNode): vscode.TreeItem {
	const name = path.posix.basename(node.relativePath);
	const folder = path.posix.dirname(node.relativePath);
	const item = new vscode.TreeItem(name, vscode.TreeItemCollapsibleState.Expanded);
	item.id = node.uri.toString();
	// The scheme and query only feed the row's color; the file icon still comes from the name.
	item.resourceUri = node.uri.with({ scheme: ROW_SCHEME, query: node.worst ?? '' });
	item.iconPath = vscode.ThemeIcon.File;
	item.description = folder === '.' ? `${node.leftovers.length}` : `${node.leftovers.length} · ${folder}`;
	item.tooltip = `${fileSummary(name, node.leftovers.map((l) => l.label))}\n${node.relativePath}`;
	// "fixable" shows the Fix all button.
	item.contextValue = node.leftovers.some((l) => l.fix) ? 'leftoverFile.fixable' : 'leftoverFile';
	return item;
}

function leftoverItem(leftover: Leftover): vscode.TreeItem {
	const line = leftover.range.start.line;
	const lead = leftover.lineText.length - leftover.lineText.trimStart().length;
	let snippet = leftover.lineText.trim();
	if (snippet.length > MAX_SNIPPET) {
		snippet = `${snippet.slice(0, MAX_SNIPPET - 1)}…`;
	}
	const prefix = `${line + 1}  `;
	const from = Math.min(snippet.length, Math.max(0, leftover.range.start.character - lead));
	const to = Math.min(snippet.length, Math.max(from, leftover.range.end.character - lead));
	const label: vscode.TreeItemLabel = {
		label: prefix + snippet,
		highlights: to > from ? [[prefix.length + from, prefix.length + to]] : [],
	};

	const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
	item.id = `${leftover.uri.toString()}#${line}:${leftover.range.start.character}:${leftover.ruleId}`;
	item.description = leftover.label;
	const [icon, color] = SEVERITY_ICON[leftover.severity];
	item.iconPath = new vscode.ThemeIcon(icon, new vscode.ThemeColor(color));
	item.tooltip = `${leftover.message}\nLine ${line + 1} · rule ${leftover.ruleId} (${leftover.severity})`;
	item.contextValue = 'leftover';
	item.command = {
		command: 'vscode.open',
		title: 'Open at Leftover',
		arguments: [leftover.uri, { selection: leftover.range } satisfies vscode.TextDocumentShowOptions],
	};
	return item;
}

/** Path from the repository root with `/` separators, as Git's Changes list shows it. */
function repoRelativePath(root: string, uri: vscode.Uri, withRepoName: boolean): string {
	const relative = path.relative(root, uri.fsPath).split(path.sep).join('/');
	return withRepoName ? `${path.basename(root)}/${relative}` : relative;
}

function rowDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
	if (uri.scheme !== ROW_SCHEME) {
		return undefined;
	}
	const color = FILE_COLOR[uri.query as Severity];
	return color ? new vscode.FileDecoration(undefined, undefined, new vscode.ThemeColor(color)) : undefined;
}
