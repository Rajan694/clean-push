import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { GitExtension } from '../git/git';

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

			await vscode.extensions.getExtension(EXTENSION_ID)!.activate();
			const gitExtension = await vscode.extensions.getExtension<GitExtension>('vscode.git')!.activate();
			const repository = await gitExtension.getAPI(1).openRepository(vscode.Uri.file(dir));
			assert.ok(repository, 'the Git extension opened the test repository');
		});

		suiteTeardown(async () => {
			await vscode.commands.executeCommand('workbench.action.closeAllEditors');
			try {
				fs.rmSync(dir, { recursive: true, force: true });
			} catch {
				// Windows may still hold a handle; the OS cleans the temp folder eventually.
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
	});
});
