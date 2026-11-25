import * as assert from 'assert';
import { applyFixes, fixTitle, ignoreSuffix, type FixTarget } from '../fixes';
import { languageFromPath, syntaxFor } from '../languages';
import { lexLines } from '../lexer';
import { ignoreMatcher } from '../match';
import { activeRules } from '../rules';
import { scanText } from '../scanner';

function targets(path: string, lines: string[]): FixTarget[] {
	return scanText(lines.join('\n'), path, languageFromPath(path), 'all', {
		rules: activeRules({}),
		ignore: ignoreMatcher(['console.warn', 'console.error']),
		ignoreComment: 'leftover-ignore',
	});
}

/** Fixes every leftover the scanner finds and returns the new lines. */
function fixAll(path: string, lines: string[]): { lines: string[]; applied: number } {
	const languageId = languageFromPath(path);
	return applyFixes(lines, lexLines(lines, syntaxFor(languageId)), languageId, targets(path, lines));
}

suite('fixes', () => {
	test('removes a statement that is alone on its line, with its comment', () => {
		assert.deepStrictEqual(fixAll('a.ts', ['a();', '  console.log(x);', '\tdebugger; // stop here', 'b();']).lines, ['a();', 'b();']);
	});

	test('removes just the call when other code shares the line', () => {
		assert.deepStrictEqual(fixAll('a.ts', ['  foo(); console.log(x);', '  console.log(y); bar();']).lines, ['  foo();', '  bar();']);
		assert.deepStrictEqual(fixAll('a.tsx', ['<div>{console.log(x)}</div>']).lines, ['<div>{}</div>']);
	});

	test('follows a call over several lines', () => {
		assert.deepStrictEqual(fixAll('a.js', ['console.log(', '  "a",', '  b', ');', 'next();']).lines, ['next();']);
	});

	test('leaves leftovers whose removal could break the code', () => {
		const unsafe = ['const y = console.log(x);', 'if (a) console.log(x);', 'items.map((x) => console.log(x));', 'console.log(x) || other();'];
		const result = fixAll('a.ts', unsafe);
		assert.strictEqual(result.applied, 0);
		assert.deepStrictEqual(result.lines, unsafe);
	});

	test('Python: keeps blocks non-empty, and handles two leftovers on one line', () => {
		assert.deepStrictEqual(fixAll('a.py', ['def f():', '    breakpoint()', 'x = 1']).lines, ['def f():', '    pass', 'x = 1']);
		assert.deepStrictEqual(fixAll('a.py', ['def f():', '    import pdb; pdb.set_trace()', '    return 1']).lines, ['def f():', '    return 1']);
	});

	test('focused tests lose .only or the f', () => {
		const lines = ['describe.only("s", () => {', '  fit("a", () => {});', '  test.describe.only("b", () => {});', '});'];
		assert.deepStrictEqual(fixAll('a.test.ts', lines).lines, ['describe("s", () => {', '  it("a", () => {});', '  test.describe("b", () => {});', '});']);
	});

	test('skips a target whose line changed since it was scanned', () => {
		const lines = ['console.log(x);'];
		const [target] = targets('a.js', lines);
		const result = applyFixes(['console.log(y);'], lexLines(['console.log(y);'], syntaxFor('javascript')), 'javascript', [target]);
		assert.strictEqual(result.applied, 0);
	});

	test('titles', () => {
		const [only, fit] = targets('a.test.js', ['it.only("a")', 'fit("b")']);
		assert.strictEqual(fixTitle(only, 'it.only("a")', 'focused test'), 'Remove .only');
		assert.strictEqual(fixTitle(fit, 'fit("b")', 'focused test'), 'Change fit to it');
		const [log] = targets('a.js', ['console.log(1)']);
		assert.strictEqual(fixTitle(log, 'console.log(1)', 'console.log'), 'Remove console.log');
	});

	test('ignore suffix uses the language comment syntax', () => {
		const suffix = (languageId: string, text: string) =>
			ignoreSuffix(text, lexLines([text], syntaxFor(languageId))[0], languageId, 'leftover-ignore');
		assert.strictEqual(suffix('typescript', 'console.log(x);  '), ' // leftover-ignore');
		assert.strictEqual(suffix('typescript', 'console.log(x); // debug'), ' leftover-ignore');
		assert.strictEqual(suffix('typescript', 'console.log(x); /* debug */'), ' // leftover-ignore');
		assert.strictEqual(suffix('python', 'breakpoint()'), ' # leftover-ignore');
		assert.strictEqual(suffix('css', 'a { }'), ' /* leftover-ignore */');
		assert.strictEqual(suffix('markdown', '- TODO'), ' <!-- leftover-ignore -->');
		assert.strictEqual(suffix('json', '{ "a": 1 }'), undefined);
		assert.strictEqual(suffix('javascript', 'const s = `still in a template'), undefined);

		// The suffix really makes the scanner skip the line.
		for (const [path, line] of [['a.ts', 'console.log(x);'], ['a.py', 'breakpoint()'], ['a.ts', 'debugger; // why']] as const) {
			const languageId = languageFromPath(path);
			const fixed = line + suffix(languageId, line)!;
			assert.deepStrictEqual(targets(path, [fixed]), [], fixed);
		}
	});
});
