import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { TestApi } from '../extension';
import type { GitExtension } from '../git/git';
import type { FileNode, LeftoverNode } from '../ui/leftoversView';
import { removeTempDir } from './tempDir';

const EXTENSION_ID = 'rajan694.clean-push';

/** Polls until `read()` returns a value that passes `done`, or fails after `timeoutMs`. */
async function waitFor<T>(read: () => T, done: (value: T) => boolean, timeoutMs = 15000): Promise<T> {
	const until = Date.now() + timeoutMs;
	for (;;) {
		const value = read();
		if (done(value) || Date.now() > until) {
			return value;
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
}

/**
 * Asks for the quick fixes at a range. VS Code cancels the request if the document changes
 * meanwhile (a file watcher can catch up with a write just after the test opens the file),
 * so try again a few times, as the editor itself would.
 */
async function quickFixes(uri: vscode.Uri, range: vscode.Range): Promise<vscode.CodeAction[]> {
	await vscode.workspace.openTextDocument(uri); // code actions need an open document
	for (let attempt = 1; ; attempt++) {
		try {
			return await vscode.commands.executeCommand<vscode.CodeAction[]>(
				'vscode.executeCodeActionProvider',
				uri,
				range,
				vscode.CodeActionKind.QuickFix.value,
			);
		} catch (e) {
			if (attempt >= 5 || !(e instanceof Error) || e.message !== 'Canceled') {
				throw e;
			}
			await new Promise((resolve) => setTimeout(resolve, 200));
		}
	}
}

function leftoverDiagnostics(uri: vscode.Uri): vscode.Diagnostic[] {
	return vscode.languages.getDiagnostics(uri).filter((d) => d.source === 'clean-push');
}

suite('Clean Push', () => {
	test('is installed', () => {
		assert.ok(vscode.extensions.getExtension(EXTENSION_ID));
	});

	test('activates and registers its commands', async () => {
		const extension = vscode.extensions.getExtension(EXTENSION_ID)!;
		await extension.activate();
		assert.strictEqual(extension.isActive, true);

		const commands = await vscode.commands.getCommands(true);
		for (const id of ['cleanPush.refresh', 'cleanPush.changeScope', 'cleanPush.installHook']) {
			assert.ok(commands.includes(id), id);
		}
	});

	suite('in a git repository', function () {
		this.timeout(60000);
		let dir: string;
		let api: TestApi;
		const git = (...args: string[]) =>
			execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args], {
				cwd: dir,
				encoding: 'utf8',
			});

		suiteSetup(async () => {
			dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'clean-push-e2e-')));
			git('init', '-q', '-b', 'main');
			fs.writeFileSync(path.join(dir, 'app.ts'), 'export const a = 1;\n');
			git('add', '.');
			git('commit', '-qm', 'init');

			api = await vscode.extensions.getExtension<TestApi>(EXTENSION_ID)!.activate();
			const gitExtension = await vscode.extensions.getExtension<GitExtension>('vscode.git')!.activate();
			const repository = await gitExtension.getAPI(1).openRepository(vscode.Uri.file(dir));
			assert.ok(repository, 'the Git extension opened the test repository');
		});

		suiteTeardown(async () => {
			await vscode.commands.executeCommand('workbench.action.closeAllEditors');
			try {
				removeTempDir(dir);
			} catch {
				// The Git extension may still hold a handle on Windows; the OS cleans the temp folder eventually.
			}
		});

		test('warns about a new console.log after saving, and not after committing it', async () => {
			const uri = vscode.Uri.file(path.join(dir, 'app.ts'));
			const doc = await vscode.workspace.openTextDocument(uri);
			const edit = new vscode.WorkspaceEdit();
			edit.insert(uri, new vscode.Position(1, 0), 'console.log("debug");\nconsole.log("kept"); // leftover-ignore\n');
			assert.ok(await vscode.workspace.applyEdit(edit));
			assert.ok(await doc.save());

			const found = await waitFor(() => leftoverDiagnostics(uri), (d) => d.length > 0);
			assert.deepStrictEqual(
				found.map((d) => [d.range.start.line, d.code, d.severity, d.message]),
				[[1, 'console', vscode.DiagnosticSeverity.Warning, 'console.log left in code']],
			);

			// The branch has no upstream, so only uncommitted lines count: committing clears it.
			git('commit', '-qam', 'add logging');
			await vscode.commands.executeCommand('cleanPush.refresh');
			const after = await waitFor(() => leftoverDiagnostics(uri), (d) => d.length === 0);
			assert.deepStrictEqual(after, []);
		});

		test('checks untracked files', async () => {
			const file = path.join(dir, 'src', 'feature.test.js');
			fs.mkdirSync(path.dirname(file), { recursive: true });
			fs.writeFileSync(file, 'it.only("works", () => {\n  debugger;\n});\n');
			await vscode.commands.executeCommand('cleanPush.refresh');

			const uri = vscode.Uri.file(file);
			const found = await waitFor(() => leftoverDiagnostics(uri), (d) => d.length >= 2);
			assert.deepStrictEqual(
				found.map((d) => [d.range.start.line, d.code, d.severity]),
				[
					[0, 'focused-test', vscode.DiagnosticSeverity.Error],
					[1, 'debugger', vscode.DiagnosticSeverity.Warning],
				],
			);
		});

		// Uses the untracked test file from the previous test.
		test('lists leftovers in the Leftovers view, and Jump opens the first one', async () => {
			const view = api.leftoversView;
			const files = view.getChildren() as FileNode[];
			const file = files.find((f) => f.relativePath === 'src/feature.test.js');
			assert.ok(file, `rows: ${files.map((f) => f.relativePath).join(', ')}`);
			assert.strictEqual(view.treeView.description, '2 in 1 file');

			const fileItem = view.getTreeItem(file);
			assert.strictEqual(fileItem.label, 'feature.test.js');
			assert.strictEqual(fileItem.description, '2 · src');
			assert.strictEqual(fileItem.tooltip, 'feature.test.js — 2 leftovers: 1 focused test, 1 debugger\nsrc/feature.test.js');
			assert.strictEqual(fileItem.contextValue, 'leftoverFile.fixable');

			const rows = (view.getChildren(file) as LeftoverNode[]).map((node) => view.getTreeItem(node));
			assert.deepStrictEqual(
				rows.map((r) => [r.label, r.description]),
				[
					[{ label: '1  it.only("works", () => {', highlights: [[3, 10]] }, 'focused test'],
					[{ label: '2  debugger;', highlights: [[3, 12]] }, 'debugger'],
				],
			);
			assert.strictEqual(rows[1].command?.command, 'vscode.open');

			await vscode.commands.executeCommand('cleanPush.openFirstLeftover', file);
			const editor = vscode.window.activeTextEditor;
			assert.strictEqual(editor?.document.uri.fsPath, file.uri.fsPath);
			assert.ok(editor.selection.isEqual(new vscode.Selection(0, 0, 0, 7)), JSON.stringify(editor.selection));
		});

		test('lightbulb: remove the leftover, or ignore the line', async () => {
			const file = path.join(dir, 'src', 'quick.ts');
			fs.writeFileSync(file, 'export function f() {\n  console.log("x");\n}\n');
			await vscode.commands.executeCommand('cleanPush.refresh');
			const uri = vscode.Uri.file(file);
			const [diagnostic] = await waitFor(() => leftoverDiagnostics(uri), (d) => d.length > 0);
			assert.ok(diagnostic);

			const doc = await vscode.workspace.openTextDocument(uri);
			const actions = await quickFixes(uri, diagnostic.range);
			// Other extensions (e.g. Copilot) may add actions, in any order around ours.
			const ours = actions.filter((a) => a.title === 'Remove console.log' || a.title.startsWith('Ignore this line'));
			assert.deepStrictEqual(ours.map((a) => a.title), ['Remove console.log', 'Ignore this line (// leftover-ignore)']);

			assert.ok(await vscode.workspace.applyEdit(ours[1].edit!));
			assert.strictEqual(doc.getText(), 'export function f() {\n  console.log("x"); // leftover-ignore\n}\n');
			await vscode.commands.executeCommand('undo');
			assert.ok(await vscode.workspace.applyEdit(ours[0].edit!));
			assert.strictEqual(doc.getText(), 'export function f() {\n}\n');
			await doc.save();
			assert.deepStrictEqual(await waitFor(() => leftoverDiagnostics(uri), (d) => d.length === 0), []);
		});

		test('Fix all removes every fixable leftover in a file and saves it', async () => {
			const file = path.join(dir, 'src', 'feature.test.js');
			await vscode.commands.executeCommand('cleanPush.fixAllInFile', vscode.Uri.file(file));
			assert.strictEqual(fs.readFileSync(file, 'utf8'), 'it("works", () => {\n});\n');
			assert.deepStrictEqual(await waitFor(() => leftoverDiagnostics(vscode.Uri.file(file)), (d) => d.length === 0), []);
		});

		test('a new .env file: env-file and secret, fixed by Add to .gitignore', async () => {
			const env = vscode.Uri.file(path.join(dir, '.env'));
			fs.writeFileSync(env.fsPath, 'API_KEY=abcd1234efgh5678\n');
			await vscode.commands.executeCommand('cleanPush.refresh');
			const found = await waitFor(() => leftoverDiagnostics(env), (d) => d.length >= 2);
			assert.deepStrictEqual(
				found.map((d) => [d.code, d.severity, d.range.start.line]),
				[
					['env-file', vscode.DiagnosticSeverity.Error, 0],
					['secret', vscode.DiagnosticSeverity.Error, 0],
				],
			);

			const actions = await quickFixes(env, found[0].range);
			assert.ok(actions.some((a) => a.title === 'Add to .gitignore'), actions.map((a) => a.title).join(', '));

			await vscode.commands.executeCommand('cleanPush.addToGitignore', env);
			assert.strictEqual(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), '/.env\n');
			await vscode.commands.executeCommand('cleanPush.refresh');
			assert.deepStrictEqual(await waitFor(() => leftoverDiagnostics(env), (d) => d.length === 0), []);
		});

		test('installs and uninstalls the pre-push hook', async () => {
			const hook = path.join(dir, '.git', 'hooks', 'pre-push');
			await vscode.commands.executeCommand('cleanPush.installHook', dir);
			assert.match(fs.readFileSync(hook, 'utf8'), /^#!\/bin\/sh\n# clean-push v1 /);
			await vscode.commands.executeCommand('cleanPush.uninstallHook', dir);
			assert.strictEqual(fs.existsSync(hook), false);
		});
	});
});
