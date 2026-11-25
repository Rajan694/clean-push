import * as vscode from 'vscode';
import { SECTION } from './config';
import type { Scope } from './git/changedFiles';
import type { LeftoverStore } from './store';
import { fixAllEdit } from './codeActions';
import { plural } from './summary';

/** Commands whose features arrive in later milestones (see docs/DESIGN.md, "Milestones"). */
const PLANNED: Record<string, string> = {
	'cleanPush.installHook': 'v1.0',
	'cleanPush.uninstallHook': 'v1.0',
};

const SCOPE_ITEMS: readonly { scope: Scope; label: string; detail: string }[] = [
	{ scope: 'unpushed', label: 'Unpushed', detail: 'Commits not pushed yet, plus staged and unstaged changes.' },
	{ scope: 'uncommitted', label: 'Uncommitted', detail: 'Staged and unstaged changes.' },
	{ scope: 'staged', label: 'Staged', detail: 'Staged changes only.' },
];

export function registerCommands(store: LeftoverStore, refresh: () => Promise<void>): vscode.Disposable {
	const disposables = [
		vscode.commands.registerCommand('cleanPush.refresh', () =>
			vscode.window.withProgress({ location: { viewId: 'workbench.scm' } }, refresh),
		),
		vscode.commands.registerCommand('cleanPush.changeScope', changeScope),
		vscode.commands.registerCommand('cleanPush.openFirstLeftover', (target?: { uri: vscode.Uri } | vscode.Uri) =>
			openFirstLeftover(store, target),
		),
		vscode.commands.registerCommand('cleanPush.fixAllInFile', (target?: { uri: vscode.Uri } | vscode.Uri) =>
			fixAllInFile(store, target),
		),
	];
	for (const [id, milestone] of Object.entries(PLANNED)) {
		disposables.push(
			vscode.commands.registerCommand(id, () => {
				void vscode.window.showInformationMessage(`Clean Push: this command arrives in ${milestone}.`);
			}),
		);
	}
	return vscode.Disposable.from(...disposables);
}

/**
 * The Jump button on a file row: opens the file with its first leftover selected. Takes the
 * row, a file URI, or nothing (the active editor's file).
 */
async function openFirstLeftover(store: LeftoverStore, target?: { uri: vscode.Uri } | vscode.Uri): Promise<void> {
	const uri = targetUri(target);
	if (!uri) {
		return;
	}
	const [first] = [...store.get(uri)].sort((a, b) => a.range.start.compareTo(b.range.start));
	if (!first) {
		void vscode.window.showInformationMessage('Clean Push: no leftovers in this file.');
		return;
	}
	await vscode.window.showTextDocument(uri, { selection: first.range });
}

/** The file a command is for: a view row, a URI, or else the active editor's file. */
function targetUri(target?: { uri: vscode.Uri } | vscode.Uri): vscode.Uri | undefined {
	return target instanceof vscode.Uri ? target : (target?.uri ?? vscode.window.activeTextEditor?.document.uri);
}

/**
 * Fix all: removes every leftover in the file that has a safe fix. A file that had no unsaved
 * changes is saved afterwards, so it is checked again straight away.
 */
async function fixAllInFile(store: LeftoverStore, target?: { uri: vscode.Uri } | vscode.Uri): Promise<void> {
	const uri = targetUri(target);
	const leftovers = uri ? store.get(uri) : [];
	if (!uri || leftovers.length === 0) {
		void vscode.window.showInformationMessage('Clean Push: no leftovers in this file.');
		return;
	}
	const document = await vscode.workspace.openTextDocument(uri);
	const wasDirty = document.isDirty;
	const { edit, applied } = fixAllEdit(document, leftovers);
	if (!edit) {
		void vscode.window.showInformationMessage(
			`Clean Push: none of the ${plural(leftovers.length, 'leftover')} in this file can be removed automatically.`,
		);
		return;
	}
	const workspaceEdit = new vscode.WorkspaceEdit();
	workspaceEdit.set(uri, [edit]);
	if (!(await vscode.workspace.applyEdit(workspaceEdit))) {
		void vscode.window.showErrorMessage('Clean Push: could not edit the file.');
		return;
	}
	if (!wasDirty) {
		await document.save();
	}
	const left = leftovers.length - applied;
	void vscode.window.showInformationMessage(
		`Clean Push: removed ${plural(applied, 'leftover')}` + (left > 0 ? `; ${left} need${left === 1 ? 's' : ''} a manual fix.` : '.'),
	);
}

/** Lets the user pick `cleanPush.scope`; saved where it is already set, else in user settings. */
async function changeScope(): Promise<void> {
	const config = vscode.workspace.getConfiguration(SECTION);
	const current = config.get<Scope>('scope', 'unpushed');
	const picked = await vscode.window.showQuickPick(
		SCOPE_ITEMS.map((item) => ({ ...item, description: item.scope === current ? 'current' : undefined })),
		{ title: 'Clean Push: Which lines to check', placeHolder: 'Pick the changes Clean Push checks for leftovers' },
	);
	if (!picked || picked.scope === current) {
		return;
	}
	const inspected = config.inspect<Scope>('scope');
	const target =
		inspected?.workspaceValue !== undefined ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
	await config.update('scope', picked.scope, target);
}
