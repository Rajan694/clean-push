import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { gitRunner, listChangedFiles, type ChangeSet } from '../git/changedFiles';

/** A throwaway repository; git runs with a fixed identity so commits work anywhere. */
function makeRepo(): { dir: string; git: (...args: string[]) => string; write: (file: string, text: string) => void } {
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'clean-push-')));
	const git = (...args: string[]) =>
		execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args], {
			cwd: dir,
			encoding: 'utf8',
		});
	git('init', '-q', '-b', 'main');
	const write = (file: string, text: string) => {
		fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
		fs.writeFileSync(path.join(dir, file), text);
	};
	return { dir, git, write };
}

function summary(changes: ChangeSet): Record<string, unknown> {
	return Object.fromEntries(changes.files.map((f) => [f.relativePath, f.addedLines]));
}

suite('changedFiles (real git)', function () {
	this.timeout(20000);
	const dirs: string[] = [];
	teardown(() => {
		for (const dir of dirs.splice(0)) {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
	function repo() {
		const r = makeRepo();
		dirs.push(r.dir);
		return { ...r, run: gitRunner('git', r.dir) };
	}

	test('no commits yet: every tracked and untracked file is new', async () => {
		const { write, git, run } = repo();
		write('a.ts', 'x\n');
		write('sub dir/b.ts', 'y\n');
		git('add', 'a.ts');
		const changes = await listChangedFiles(run, 'unpushed');
		assert.deepStrictEqual(summary(changes), { 'a.ts': 'all', 'sub dir/b.ts': 'all' });
	});

	test('uncommitted: added lines against HEAD, plus untracked files', async () => {
		const { write, git, run } = repo();
		write('a.ts', 'one\ntwo\nthree\n');
		write('.gitignore', 'ignored.ts\n');
		git('add', '.');
		git('commit', '-qm', 'init');
		write('a.ts', 'one\nNEW\ntwo\nthree\nEND\n');
		write('new.ts', 'n\n');
		write('ignored.ts', 'i\n');
		const changes = await listChangedFiles(run, 'uncommitted');
		assert.strictEqual(changes.scope, 'uncommitted');
		assert.deepStrictEqual(summary(changes), {
			'a.ts': [
				{ start: 1, end: 1 },
				{ start: 4, end: 4 },
			],
			'new.ts': 'all',
		});
	});

	test('unpushed: includes commits not pushed yet; falls back without an upstream', async () => {
		const remote = repo();
		remote.git('init', '-q', '--bare', '-b', 'main', 'remote.git');
		const { write, git, run } = repo();
		write('a.ts', 'one\n');
		git('add', '.');
		git('commit', '-qm', 'init');

		write('a.ts', 'one\ncommitted\n');
		git('commit', '-qam', 'local');
		assert.strictEqual((await listChangedFiles(run, 'unpushed')).scope, 'uncommitted');
		assert.deepStrictEqual(summary(await listChangedFiles(run, 'unpushed')), {});

		git('remote', 'add', 'origin', path.join(remote.dir, 'remote.git'));
		git('push', '-q', '-u', 'origin', 'main');
		write('a.ts', 'one\ncommitted\nunpushed\n');
		git('commit', '-qam', 'not pushed');
		write('a.ts', 'one\ncommitted\nunpushed\nunstaged\n');

		const changes = await listChangedFiles(run, 'unpushed');
		assert.strictEqual(changes.scope, 'unpushed');
		assert.deepStrictEqual(summary(changes), { 'a.ts': [{ start: 2, end: 3 }] });
		assert.deepStrictEqual(summary(await listChangedFiles(run, 'uncommitted')), { 'a.ts': [{ start: 3, end: 3 }] });
	});

	test('marks added files, including binary and empty ones', async () => {
		const { dir, write, git, run } = repo();
		write('old.ts', 'a\n');
		git('add', '.');
		git('commit', '-qm', 'init');
		write('old.ts', 'a\nb\n');
		fs.writeFileSync(path.join(dir, 'image.bin'), Buffer.from([0x89, 0x50, 0x00, 0x01, 0x02]));
		write('empty.ts', '');
		write('staged-new.ts', 'x\n');
		git('add', 'image.bin', 'empty.ts', 'staged-new.ts');
		write('untracked.ts', 'u\n');

		const changes = await listChangedFiles(run, 'uncommitted');
		const byPath = Object.fromEntries(changes.files.map((f) => [f.relativePath, [f.isNew, f.addedLines]]));
		assert.deepStrictEqual(byPath, {
			'old.ts': [false, [{ start: 1, end: 1 }]],
			'staged-new.ts': [true, [{ start: 0, end: 0 }]],
			'empty.ts': [true, []],
			'image.bin': [true, []],
			'untracked.ts': [true, 'all'],
		});
		const staged = await listChangedFiles(run, 'staged');
		assert.deepStrictEqual(staged.files.map((f) => f.relativePath).sort(), ['empty.ts', 'image.bin', 'staged-new.ts']);
	});

	test('staged: index lines mapped to the working tree', async () => {
		const { write, git, run } = repo();
		write('a.ts', 'one\ntwo\n');
		git('add', '.');
		git('commit', '-qm', 'init');
		write('a.ts', 'one\nstaged\ntwo\n');
		git('add', 'a.ts');
		write('a.ts', 'top\none\nstaged\ntwo\nunstaged\n');
		write('untracked.ts', 'u\n');
		const changes = await listChangedFiles(run, 'staged');
		assert.deepStrictEqual(summary(changes), { 'a.ts': [{ start: 2, end: 2 }] });
	});
});
