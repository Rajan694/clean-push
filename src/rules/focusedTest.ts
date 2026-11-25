import type { LineView, Rule, RuleMatch } from '../model';
import { JS_LANGUAGES } from '../languages';
import { isTestFile } from './util';

// describe.only(, it.only(, test.only(, test.describe.only( ... and Jasmine's fit( / fdescribe(.
const ONLY = /(?<![\w$])((?:describe|context|suite|it|test|specify)(?:\s*\.\s*\w+)*?\s*\.\s*only)\s*\(/;
const FOCUSED = /(?<![\w$.])(fdescribe|fcontext|fit|ftest)\s*\(/;

/** `.only(`, `fit(` and `fdescribe(` in JavaScript and TypeScript test files. */
export const focusedTest: Rule = {
	id: 'focused-test',
	languages: JS_LANGUAGES,
	defaultSeverity: 'error',
	appliesToFile: isTestFile,
	fix: 'removeMatch',
	check(line: LineView): RuleMatch[] {
		const m = ONLY.exec(line.code) ?? FOCUSED.exec(line.code);
		if (!m) {
			return [];
		}
		const name = m[1].replace(/\s+/g, '');
		return [{ start: m.index, end: m.index + m[1].length, message: `Focused test: ${name} skips every other test`, label: 'focused test' }];
	},
};
