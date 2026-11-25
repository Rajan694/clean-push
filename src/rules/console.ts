import type { LineView, Rule, RuleMatch } from '../model';
import { JS_LANGUAGES } from '../languages';
import { callEnd } from './util';

const CONSOLE_CALL = /(?<![\w$.])console\s*\.\s*(log|debug|info|trace|warn|error|dir|table)\s*\(/g;

/**
 * console.log, .debug, .info, .trace, .warn, .error, .dir and .table calls. The scanner drops
 * calls in cleanPush.ignoreList (console.warn and console.error by default).
 */
export const consoleRule: Rule = {
	id: 'console',
	languages: JS_LANGUAGES,
	defaultSeverity: 'warning',
	fix: 'removeLine',
	check(line: LineView): RuleMatch[] {
		return [...line.code.matchAll(CONSOLE_CALL)].map((m) => ({
			start: m.index,
			end: callEnd(line.code, m.index + m[0].length - 1),
			message: `console.${m[1]} left in code`,
			label: `console.${m[1]}`,
		}));
	},
};
