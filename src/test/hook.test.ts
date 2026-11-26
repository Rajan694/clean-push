import * as assert from 'assert';
import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { gitRunner } from '../git/changedFiles';
import { HOOK_MARKER, hookScript, hookSnippet, hookState, writeHook } from '../hook/hookFile';
import { removeTempDir } from './tempDir';

const IDENTITY = ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false'];

suite('pre-push hook (real git)', function () {
	this.timeout(30000);
	let dir: string;
	let remote: string;
	const git = (...args: string[]) => execFileSync('git', [...IDENTITY, ...args], { cwd: dir, encoding: 'utf8' });
	/** Runs git push and returns its exit code and stderr, without throwing. */
	const push = (...args: string[]) => {
		const r = spawnSync('git', [...IDENTITY, 'push', ...args], { cwd: dir, encoding: 'utf8' });
		return { code: r.status, stderr: r.stderr };
	};
	const commit = (file: string, text: string) => {
		fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
		fs.writeFileSync(path.join(dir, file), text);
		git('add', '.');
		git('commit', '-qm', `change ${file}`);
	};

	setup(() => {
		const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'clean-push-hook-')));
		dir = path.join(base, 'work');
		remote = path.join(base, 'remote.git');
		fs.mkdirSync(dir);
		execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
		git('init', '-q', '-b', 'main');
		git('remote', 'add', 'origin', remote);
		commit('README.md', 'hello\n');
		git('push', '-q', '-u', 'origin', 'main');
	});
	teardown(() => removeTempDir(path.dirname(dir)));

	test('the script is marked as ours and the snippet has the same checks', () => {
		const script = hookScript();
		assert.ok(script.startsWith(`#!/bin/sh\n${HOOK_MARKER} `));
		assert.ok(hookSnippet().includes('grep -E "$pattern"'));
	});

	test('install, detect and blocks leftovers in pushed commits', async () => {
		const run = gitRunner('git', dir);
		const before = await hookState(run, dir);
		assert.strictEqual(before.kind, 'none');
		await writeHook((before as { file: string }).file);
		assert.strictEqual((await hookState(run, dir)).kind, 'ours');
		if (process.platform !== 'win32') {
			assert.ok(fs.statSync(path.join(dir, '.git', 'hooks', 'pre-push')).mode & 0o100, 'hook is executable');
		}

		// A focused test blocks the push; the message names the file.
		commit('src/a.test.js', 'it.only("x", () => {});\n');
		let result = push('-q', 'origin', 'main');
		assert.notStrictEqual(result.code, 0);
		assert.match(result.stderr, /clean-push: leftovers in the commits for refs\/heads\/main:/);
		assert.match(result.stderr, /src\/a\.test\.js: it\.only\("x"/);
		assert.match(result.stderr, /git push --no-verify/);

		// --no-verify skips the hook.
		assert.strictEqual(push('-q', '--no-verify', 'origin', 'main').code, 0);

		// Clean commits push fine; warnings such as console.log never block.
		commit('src/b.js', 'console.log("fine for the hook");\n');
		assert.strictEqual(push('-q', 'origin', 'main').code, 0);

		// A new branch is checked against everything already on the remote.
		git('checkout', '-q', '-b', 'feature');
		commit('src/c.ts', 'a\n<<<<<<< HEAD\nb\n=======\nc\n>>>>>>> other\n');
		commit('key.pem', '-----BEGIN RSA PRIVATE KEY-----\nabc\n');
		result = push('-q', '-u', 'origin', 'feature');
		assert.notStrictEqual(result.code, 0);
		assert.match(result.stderr, /src\/c\.ts: <<<<<<< HEAD/);
		assert.match(result.stderr, /src\/c\.ts: >>>>>>> other/);
		assert.match(result.stderr, /key\.pem: -----BEGIN RSA PRIVATE KEY-----/);
	});

	test('leaves other hooks and core.hooksPath alone', async () => {
		const run = gitRunner('git', dir);
		const hook = path.join(dir, '.git', 'hooks', 'pre-push');
		fs.writeFileSync(hook, '#!/bin/sh\necho mine\n');
		assert.deepStrictEqual(await hookState(run, dir), { kind: 'foreign', file: hook });

		git('config', 'core.hooksPath', '.husky');
		assert.deepStrictEqual(await hookState(run, dir), { kind: 'hooksPath', hooksPath: '.husky' });
	});

	test('the snippet works inside another pre-push hook', () => {
		const hook = path.join(dir, '.git', 'hooks', 'pre-push');
		fs.writeFileSync(hook, `#!/bin/sh\n${hookSnippet()}echo "their own checks ran" >&2\n`, { mode: 0o755 });
		commit('t.spec.ts', 'describe.only("s", () => {});\n');
		const blocked = push('-q', 'origin', 'main');
		assert.notStrictEqual(blocked.code, 0);
		assert.match(blocked.stderr, /t\.spec\.ts: describe\.only/);
		assert.doesNotMatch(blocked.stderr, /their own checks ran/);

		git('reset', '-q', '--hard', 'HEAD~1');
		commit('ok.ts', 'export const ok = true;\n');
		const passed = push('-q', 'origin', 'main');
		assert.strictEqual(passed.code, 0, passed.stderr);
		assert.match(passed.stderr, /their own checks ran/);
	});
});
