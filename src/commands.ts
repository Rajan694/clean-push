import * as path from 'path';
import * as vscode from 'vscode';
import { SECTION } from './config';
import { gitRunner, type Scope } from './git/changedFiles';
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

export interface CommandDeps {
	store: LeftoverStore;
	refresh: () => Promise<void>;
	/** Path of the git executable, once the Git extension is ready. */
	gitPath: () => string | undefined;
}

/** A file a command is for: a view row, a URI, or (when undefined) the active editor's file. */
type Target = { uri: vscode.Uri } | { leftover: { uri: vscode.Uri } } | vscode.Uri | undefined;

export function registerCommands({ store, refresh, gitPath }: CommandDeps): vscode.Disposable {
	const disposables = [
		vscode.commands.registerCommand('cleanPush.refresh', () =>
			vscode.window.withProgress({ location: { viewId: 'workbench.scm' } }, refresh),
		),
		vscode.commands.registerCommand('cleanPush.changeScope', changeScope),
		vscode.commands.registerCommand('cleanPush.openFirstLeftover', (target?: Target) => openFirstLeftover(store, target)),
		vscode.commands.registerCommand('cleanPush.fixAllInFile', (target?: Target) => fixAllInFile(store, target)),
		vscode.commands.registerCommand('cleanPush.addToGitignore', (target?: Target) => addToGitignore(store, gitPath(), target)),
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
async function openFirstLeftover(store: LeftoverStore, target?: Target): Promise<void> {
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

function targetUri(target: Target): vscode.Uri | undefined {
	if (target instanceof vscode.Uri) {
		return target;
	}
	if (target && 'leftover' in target) {
		return target.leftover.uri;
	}
	return target?.uri ?? vscode.window.activeTextEditor?.document.uri;
}

/** Line for .gitignore that matches exactly this file: rooted, with special characters escaped. */
export function gitignoreEntry(relativePath: string): string {
	return '/' + relativePath.replace(/[\\*?[\]!#]/g, '\\$&').replace(/ $/, '\\ ');
}

/**
 * Adds the file to the repository's .gitignore (for env-file and large-file). If git already
 * tracks it, offers to stop tracking it, since .gitignore alone won't keep it out of commits.
 */
async function addToGitignore(store: LeftoverStore, git: string | undefined, target: Target): Promise<void> {
	const uri = targetUri(target);
	const root = uri && store.rootOf(uri);
	if (!uri || !root) {
		void vscode.window.showWarningMessage('Clean Push: this file is not in a repository Clean Push is checking.');
		return;
	}
	const relative = path.relative(root, uri.fsPath).split(path.sep).join('/');
	const entry = gitignoreEntry(relative);
	const gitignore = vscode.Uri.file(path.join(root, '.gitignore'));

	let existing: vscode.TextDocument | undefined;
	try {
		existing = await vscode.workspace.openTextDocument(gitignore);
	} catch {
		existing = undefined;
	}
	if (!existing) {
		await vscode.workspace.fs.writeFile(gitignore, Buffer.from(`${entry}\n`, 'utf8'));
	} else if (!existing.getText().split(/\r?\n/).includes(entry)) {
		const wasDirty = existing.isDirty;
		const text = existing.getText();
		const eol = existing.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
		const edit = new vscode.WorkspaceEdit();
		edit.insert(gitignore, existing.positionAt(text.length), (text === '' || text.endsWith('\n') ? '' : eol) + entry + eol);
		await vscode.workspace.applyEdit(edit);
		if (!wasDirty) {
			await existing.save();
		}
	}

	const run = git ? gitRunner(git, root) : undefined;
	const tracked = run ? await run(['ls-files', '--error-unmatch', '--', relative]).then(() => true, () => false) : false;
	if (!tracked) {
		void vscode.window.showInformationMessage(`Clean Push: added ${entry} to .gitignore.`);
		return;
	}
	const stop = 'Stop Tracking';
	const choice = await vscode.window.showWarningMessage(
		`Clean Push: added ${entry} to .gitignore, but git already tracks ${relative}, so it would still be pushed. ` +
			'Stop tracking it? (git rm --cached: the file stays on disk)',
		stop,
	);
	if (choice === stop && run) {
		await run(['rm', '--cached', '--quiet', '--', relative]);
		void vscode.window.showInformationMessage(`Clean Push: ${relative} is no longer tracked. Commit the change to keep it out.`);
	}
}

/**
 * Fix all: removes every leftover in the file that has a safe fix. A file that had no unsaved
 * changes is saved afterwards, so it is checked again straight away.
 */
async function fixAllInFile(store: LeftoverStore, target?: Target): Promise<void> {
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
