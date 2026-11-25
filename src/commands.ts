import * as path from 'path';
import * as vscode from 'vscode';
import { SECTION } from './config';
import { gitRunner, type Scope } from './git/changedFiles';
import { hookSnippet, hookState, writeHook } from './hook/hookFile';
import * as fs from 'fs';
import type { LeftoverStore } from './store';
import { fixAllEdit } from './codeActions';
import { plural } from './summary';

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
	/** Roots of the repositories being checked. */
	repositories: () => string[];
}

/** A file a command is for: a view row, a URI, or (when undefined) the active editor's file. */
type Target = { uri: vscode.Uri } | { leftover: { uri: vscode.Uri } } | vscode.Uri | undefined;

export function registerCommands({ store, refresh, gitPath, repositories }: CommandDeps): vscode.Disposable {
	const disposables = [
		vscode.commands.registerCommand('cleanPush.refresh', () =>
			vscode.window.withProgress({ location: { viewId: 'workbench.scm' } }, refresh),
		),
		vscode.commands.registerCommand('cleanPush.changeScope', changeScope),
		vscode.commands.registerCommand('cleanPush.openFirstLeftover', (target?: Target) => openFirstLeftover(store, target)),
		vscode.commands.registerCommand('cleanPush.fixAllInFile', (target?: Target) => fixAllInFile(store, target)),
		vscode.commands.registerCommand('cleanPush.addToGitignore', (target?: Target) => addToGitignore(store, gitPath(), target)),
		vscode.commands.registerCommand('cleanPush.installHook', (root?: string) => installHook(gitPath(), root ?? repositories())),
		vscode.commands.registerCommand('cleanPush.uninstallHook', (root?: string) => uninstallHook(gitPath(), root ?? repositories())),
	];
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

/** The repository a hook command is for: the given root, the only one, or the user's pick. */
async function pickRepository(roots: string | string[], action: string): Promise<string | undefined> {
	if (typeof roots === 'string') {
		return roots;
	}
	if (roots.length === 0) {
		void vscode.window.showWarningMessage('Clean Push: no Git repository is open.');
		return undefined;
	}
	if (roots.length === 1) {
		return roots[0];
	}
	const picked = await vscode.window.showQuickPick(
		roots.map((root) => ({ label: path.basename(root), description: root, root })),
		{ title: `Clean Push: ${action}`, placeHolder: 'Pick a repository' },
	);
	return picked?.root;
}

async function showSnippet(): Promise<void> {
	const doc = await vscode.workspace.openTextDocument({ language: 'shellscript', content: hookSnippet() });
	await vscode.window.showTextDocument(doc);
}

/**
 * Writes the pre-push hook, on request only. Never overwrites a hook Clean Push didn't write,
 * and writes nothing when core.hooksPath is set (Husky, lefthook...): it shows the lines to
 * add to that hook instead.
 */
async function installHook(git: string | undefined, roots: string | string[]): Promise<void> {
	const root = await pickRepository(roots, 'Install Git Pre-push Hook');
	if (!root) {
		return;
	}
	if (!git) {
		void vscode.window.showWarningMessage('Clean Push: Git is not ready yet; try again in a moment.');
		return;
	}
	const state = await hookState(gitRunner(git, root), root);
	const name = path.basename(root);
	switch (state.kind) {
		case 'hooksPath': {
			void vscode.window.showInformationMessage(
				`Clean Push: ${name} keeps its hooks in ${state.hooksPath} (core.hooksPath, set by tools such as Husky or lefthook), ` +
					'so no hook was written. Add the lines in the new editor to your pre-push hook there.',
			);
			await showSnippet();
			return;
		}
		case 'foreign': {
			const show = 'Show Lines';
			const choice = await vscode.window.showWarningMessage(
				`Clean Push: ${name} already has a pre-push hook that Clean Push didn't write, so it was left alone. Show the lines to add to it?`,
				show,
			);
			if (choice === show) {
				await showSnippet();
			}
			return;
		}
		case 'ours':
		case 'none':
			await writeHook(state.file);
			void vscode.window.showInformationMessage(
				`Clean Push: ${state.kind === 'ours' ? 'updated' : 'installed'} the pre-push hook in ${name}. ` +
					'It blocks pushes that add conflict markers, .only, debugger or private keys; skip it once with git push --no-verify.',
			);
	}
}

/** Removes the pre-push hook, but only one Clean Push wrote. */
async function uninstallHook(git: string | undefined, roots: string | string[]): Promise<void> {
	const root = await pickRepository(roots, 'Uninstall Git Pre-push Hook');
	if (!root) {
		return;
	}
	if (!git) {
		void vscode.window.showWarningMessage('Clean Push: Git is not ready yet; try again in a moment.');
		return;
	}
	const state = await hookState(gitRunner(git, root), root);
	const name = path.basename(root);
	switch (state.kind) {
		case 'hooksPath':
			void vscode.window.showInformationMessage(
				`Clean Push: ${name} keeps its hooks in ${state.hooksPath}; remove the clean-push lines from the pre-push hook there.`,
			);
			return;
		case 'foreign':
			void vscode.window.showInformationMessage(`Clean Push: the pre-push hook in ${name} wasn't written by Clean Push; left it alone.`);
			return;
		case 'none':
			void vscode.window.showInformationMessage(`Clean Push: ${name} has no pre-push hook.`);
			return;
		case 'ours':
			await fs.promises.unlink(state.file);
			void vscode.window.showInformationMessage(`Clean Push: removed the pre-push hook from ${name}.`);
	}
}
