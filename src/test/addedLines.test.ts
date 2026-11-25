import * as assert from 'assert';
import { addedRanges, mapThroughHunks, mergeRanges, parseUnifiedDiff, unquoteGitPath } from '../git/addedLines';

suite('addedLines', () => {
	test('parses hunks per file, with and without counts', () => {
		const patch = [
			'diff --git a/src/a.ts b/src/a.ts',
			'index 1..2 100644',
			'--- a/src/a.ts',
			'+++ b/src/a.ts',
			'@@ -1,0 +2 @@ first',
			'+console.log(1)',
			'@@ -10,2 +11,3 @@',
			'+a',
			'+b',
			'+c',
			'diff --git a/gone.ts b/gone.ts',
			'deleted file mode 100644',
			'--- a/gone.ts',
			'+++ /dev/null',
			'@@ -1,3 +0,0 @@',
			'diff --git a/my file.ts b/my file.ts',
			'new file mode 100644',
			'--- /dev/null',
			'+++ b/my file.ts\t',
			'@@ -0,0 +1,2 @@',
			'',
		].join('\n');
		const files = parseUnifiedDiff(patch);
		assert.deepStrictEqual([...files.keys()], ['src/a.ts', 'my file.ts']);
		assert.deepStrictEqual(files.get('src/a.ts'), [
			{ oldStart: 1, oldCount: 0, newStart: 2, newCount: 1 },
			{ oldStart: 10, oldCount: 2, newStart: 11, newCount: 3 },
		]);
		assert.deepStrictEqual(addedRanges(files.get('src/a.ts')!), [
			{ start: 1, end: 1 },
			{ start: 10, end: 12 },
		]);
		assert.deepStrictEqual(addedRanges(files.get('my file.ts')!), [{ start: 0, end: 1 }]);
	});

	test('skips pure deletions', () => {
		assert.deepStrictEqual(addedRanges([{ oldStart: 4, oldCount: 2, newStart: 3, newCount: 0 }]), []);
	});

	test('reads quoted paths', () => {
		assert.strictEqual(unquoteGitPath('"b/caf\\303\\251 \\"x\\".ts"'), 'b/café "x".ts');
		const files = parseUnifiedDiff('+++ "b/tab\\there.ts"\n@@ -0,0 +1 @@\n');
		assert.deepStrictEqual([...files.keys()], ['tab\there.ts']);
	});

	test('merges touching ranges', () => {
		assert.deepStrictEqual(
			mergeRanges([
				{ start: 5, end: 6 },
				{ start: 0, end: 1 },
				{ start: 2, end: 2 },
			]),
			[
				{ start: 0, end: 2 },
				{ start: 5, end: 6 },
			],
		);
	});

	test('maps index lines to working-tree lines', () => {
		// Index lines 2..4 (0-based) were added. In the working tree two lines were inserted
		// after line 1 (1-based) and index line 3 (0-based) was changed.
		const hunks = [
			{ oldStart: 1, oldCount: 0, newStart: 2, newCount: 2 },
			{ oldStart: 4, oldCount: 1, newStart: 6, newCount: 1 },
		];
		assert.deepStrictEqual(mapThroughHunks([{ start: 2, end: 4 }], hunks), [
			{ start: 4, end: 4 },
			{ start: 6, end: 6 },
		]);
		assert.deepStrictEqual(mapThroughHunks([{ start: 0, end: 1 }], []), [{ start: 0, end: 1 }]);
	});
});
