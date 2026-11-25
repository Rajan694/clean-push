import * as assert from 'assert';
import type { AddedLines, Finding, SeveritySetting } from '../model';
import { languageFromPath, syntaxFor } from '../languages';
import { lexLines } from '../lexer';
import { excludeMatcher, globToRegExp, hasIgnoreComment, ignoreMatcher } from '../match';
import { activeRules } from '../rules';
import { scanText } from '../scanner';

interface Options {
	added?: AddedLines;
	ignoreList?: string[];
	rules?: Record<string, SeveritySetting>;
	languageId?: string;
}

function scan(path: string, text: string, options: Options = {}): Finding[] {
	return scanText(text, path, options.languageId ?? languageFromPath(path), options.added ?? 'all', {
		rules: activeRules(options.rules ?? {}),
		ignore: ignoreMatcher(options.ignoreList ?? ['console.warn', 'console.error']),
		ignoreComment: 'leftover-ignore',
	});
}

/** "line:ruleId" for each finding, to keep assertions short. */
function ids(findings: Finding[]): string[] {
	return findings.map((f) => `${f.line}:${f.ruleId}`);
}

suite('lexer', () => {
	test('separates code, strings and comments', () => {
		const [line] = lexLines(['const a = "x // y"; // TODO z'], syntaxFor('typescript'));
		assert.strictEqual(line.code, 'const a = "      ";          ');
		assert.strictEqual(line.comments, '                    // TODO z');
	});

	test('carries block comments and template strings across lines', () => {
		const lexed = lexLines(['/* start', 'console.log(1)', '*/ x = `a', 'console.log(2)', '` + 1'], syntaxFor('javascript'));
		assert.strictEqual(lexed[1].code.trim(), '');
		assert.strictEqual(lexed[2].code, '   x = ` ');
		assert.strictEqual(lexed[3].code.trim(), '');
		assert.strictEqual(lexed[4].code, '` + 1');
	});

	test('handles Python triple-quoted strings and escapes', () => {
		const lexed = lexLines(['s = """', 'print(1)  # not code', '""" # real', "t = 'it\\'s' # c"], syntaxFor('python'));
		assert.strictEqual(lexed[1].code.trim(), '');
		assert.strictEqual(lexed[1].comments.trim(), '');
		assert.strictEqual(lexed[2].comments.trim(), '# real');
		assert.strictEqual(lexed[3].code, "t = '     '    ");
	});
});

suite('rules', () => {
	test('console: flags console.log, not console.warn/error from the ignore list', () => {
		const findings = scan('src/app.ts', [
			'console.log("res", res);',
			'console.warn("careful");',
			'console.error(err); console.debug(x)',
			'// console.log("commented out")',
			'const s = "console.log(x)";',
			'myconsole.log(1); obj.console.log(2)',
		].join('\n'));
		assert.deepStrictEqual(ids(findings), ['0:console', '2:console']);
		assert.deepStrictEqual(findings.map((f) => f.message), ['console.log left in code', 'console.debug left in code']);
		assert.deepStrictEqual(findings.map((f) => f.label), ['console.log', 'console.debug']);
		assert.strictEqual(findings[1].text, 'console.error(err); console.debug(x)');
		// The squiggle covers the whole call, up to the semicolon.
		assert.deepStrictEqual([findings[0].start, findings[0].end], [0, 24]);
		assert.deepStrictEqual([findings[1].start, findings[1].end], [20, 36]);
	});

	test('console: an empty ignore list flags warn and error too; regex entries work', () => {
		const text = 'console.warn(1)\nconsole.error(2)\nconsole.log("[perf]", t)\nconsole.log(3)';
		assert.deepStrictEqual(ids(scan('a.js', text, { ignoreList: [] })), ['0:console', '1:console', '2:console', '3:console']);
		assert.deepStrictEqual(ids(scan('a.js', text, { ignoreList: ['/console\\.log\\("\\[perf\\]/'] })), [
			'0:console',
			'1:console',
			'3:console',
		]);
	});

	test('console: only in JavaScript-family languages', () => {
		assert.deepStrictEqual(ids(scan('notes.py', 'console.log(1)')), []);
		assert.deepStrictEqual(ids(scan('App.vue', '<script>\nconsole.log(1)\n</script>')), ['1:console']);
	});

	test('debugger: JavaScript statement', () => {
		const findings = scan('src/a.ts', ['  debugger;', 'debugger', 'const o = { debugger: true };', 'o.debugger;', '"debugger"'].join('\n'));
		assert.deepStrictEqual(ids(findings), ['0:debugger', '1:debugger']);
		assert.deepStrictEqual([findings[0].start, findings[0].end], [2, 11]);
	});

	test('debugger: Python and Ruby', () => {
		const py = ['import pdb', 'pdb.set_trace()', 'breakpoint()', 'from ipdb import set_trace', 'x = "breakpoint()"', '# breakpoint()'];
		const pyFindings = scan('a.py', py.join('\n'));
		assert.deepStrictEqual(ids(pyFindings), ['0:debugger', '1:debugger', '2:debugger', '3:debugger']);
		assert.deepStrictEqual(pyFindings.map((f) => f.label), ['import pdb', 'set_trace()', 'breakpoint()', 'import pdb']);
		const rb = ['binding.pry', '  byebug', 'debugger', 'puts "binding.pry"'];
		assert.deepStrictEqual(ids(scan('a.rb', rb.join('\n'))), ['0:debugger', '1:debugger', '2:debugger']);
	});

	test('focused-test: .only, fit and fdescribe in test files only', () => {
		const text = [
			'describe.only("x", () => {',
			'  it.only("a", () => {});',
			'  test.describe.only("pw", () => {});',
			'  fit("b", () => {});',
			'  fdescribe("c", () => {});',
			'  it("d", () => {});',
			'  this.fit(1);',
		].join('\n');
		const findings = scan('src/app.test.ts', text);
		assert.deepStrictEqual(ids(findings), ['0:focused-test', '1:focused-test', '2:focused-test', '3:focused-test', '4:focused-test']);
		assert.strictEqual(findings[1].message, 'Focused test: it.only skips every other test');
		assert.strictEqual(findings[2].message, 'Focused test: test.describe.only skips every other test');
		assert.deepStrictEqual(ids(scan('test/helpers.js', 'it.only("x")')), ['0:focused-test']);
		assert.deepStrictEqual(ids(scan('src/chart.ts', 'fit(data); it.only("x")')), []);
	});

	test('conflict-marker: all languages; ======= not in prose', () => {
		const text = ['<<<<<<< HEAD', 'a', '=======', 'b', '>>>>>>> feature', '<<<<<<<< not seven'].join('\n');
		assert.deepStrictEqual(ids(scan('a.yml', text)), ['0:conflict-marker', '2:conflict-marker', '4:conflict-marker']);
		assert.deepStrictEqual(ids(scan('README.md', 'Heading\n=======\n')), []);
	});

	test('todo: only in comments', () => {
		const text = [
			'// TODO remove before merge',
			'const TODO = 1;',
			'/* FIXME: later */ run();',
			'x = "HACK"',
			'# XXX in a hash comment',
			'// todo lowercase is fine',
		].join('\n');
		const findings = scan('a.ts', text);
		assert.deepStrictEqual(ids(findings), ['0:todo', '2:todo']);
		assert.strictEqual(findings[0].message, 'New TODO comment');
		assert.deepStrictEqual(findings.map((f) => f.label), ['new TODO', 'new FIXME']);
		assert.deepStrictEqual([findings[1].start, findings[1].end], [3, 15]);
		assert.deepStrictEqual(ids(scan('a.py', '# XXX hash comment')), ['0:todo']);
		assert.deepStrictEqual(ids(scan('README.md', '- TODO list item\n<!-- TODO hidden -->')), ['1:todo']);
	});
});

suite('scanner', () => {
	test('checks only added lines', () => {
		const text = 'console.log(1)\nconsole.log(2)\nconsole.log(3)\nconsole.log(4)';
		assert.deepStrictEqual(ids(scan('a.js', text, { added: [{ start: 1, end: 2 }] })), ['1:console', '2:console']);
		assert.deepStrictEqual(ids(scan('a.js', text, { added: [] })), []);
	});

	test('skips lines ending in leftover-ignore', () => {
		const text = 'console.log(1) // leftover-ignore\n/* TODO x leftover-ignore */\nconsole.log(2)';
		assert.deepStrictEqual(ids(scan('a.js', text)), ['2:console']);
	});

	test('uses the severity from settings, and "off" turns a rule off', () => {
		const findings = scan('a.js', 'console.log(1) // TODO', { rules: { console: 'error', todo: 'off' } });
		assert.deepStrictEqual(
			findings.map((f) => `${f.ruleId}:${f.severity}`),
			['console:error'],
		);
	});

	test('handles CRLF line endings', () => {
		const findings = scan('a.js', 'a()\r\nconsole.log(1);\r\n');
		assert.deepStrictEqual(ids(findings), ['1:console']);
		assert.strictEqual(findings[0].end, 15);
	});
});

suite('match', () => {
	test('globs', () => {
		assert.ok(globToRegExp('**/dist/**').test('dist/extension.js'));
		assert.ok(globToRegExp('**/dist/**').test('packages/a/dist/x.js'));
		assert.ok(!globToRegExp('**/dist/**').test('src/distance.ts'));
		assert.ok(globToRegExp('**/*.min.js').test('public/vendor/a.min.js'));
		assert.ok(globToRegExp('src/*.{ts,tsx}').test('src/a.tsx'));
		assert.ok(!globToRegExp('src/*.{ts,tsx}').test('src/deep/a.ts'));
		assert.ok(globToRegExp('file[0-9].txt').test('file7.txt'));

		const excluded = excludeMatcher(['**/package-lock.json', '*.snap']);
		assert.ok(excluded('package-lock.json'));
		assert.ok(excluded('a/b/package-lock.json'));
		assert.ok(excluded('src/__snapshots__/a.test.ts.snap'));
		assert.ok(!excluded('src/a.ts'));
	});

	test('ignore list skips invalid regexes', () => {
		const invalid: string[] = [];
		const ignore = ignoreMatcher(['/(/', 'logger.debug'], (entry) => invalid.push(entry));
		assert.deepStrictEqual(invalid, ['/(/']);
		assert.ok(ignore('logger.debug(x)', 0, 12));
		assert.ok(!ignore('logger.debug(x); console.log(y)', 17, 31));
	});

	test('ignore comment', () => {
		assert.ok(hasIgnoreComment('console.log(1) // leftover-ignore', 'leftover-ignore'));
		assert.ok(hasIgnoreComment('<!-- TODO leftover-ignore -->', 'leftover-ignore'));
		assert.ok(!hasIgnoreComment('// leftover-ignore is a marker; console.log(1)', 'leftover-ignore'));
		assert.ok(!hasIgnoreComment('console.log(1)', ''));
	});
});
