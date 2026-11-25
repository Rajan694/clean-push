import type { LineView, Rule, RuleMatch } from '../model';
import { callEnd } from './util';

interface Pattern {
	regex: RegExp;
	label: (m: RegExpExecArray) => string;
}

const PATTERNS: Record<string, readonly Pattern[]> = {
	python: [{ regex: /(?<![\w.])(p?print)\s*\(/g, label: (m) => `${m[1]}()` }],
	java: [{ regex: /(?<![\w.])System\s*\.\s*(out|err)\s*\.\s*(print(?:ln|f)?)\s*\(/g, label: (m) => `System.${m[1]}.${m[2]}` }],
	go: [
		{ regex: /(?<![\w.])fmt\s*\.\s*(Print(?:ln|f)?)\s*\(/g, label: (m) => `fmt.${m[1]}` },
		{ regex: /(?<![\w.])(print(?:ln)?)\s*\(/g, label: (m) => m[1] },
	],
	rust: [{ regex: /(?<![\w:])dbg!\s*\(/g, label: () => 'dbg!' }],
	php: [{ regex: /(?<![\w>:$\\])(var_dump|print_r|dd)\s*\(/g, label: (m) => m[1] }],
};

/** Debug output: `print(` in Python, System.out.println, fmt.Println, dbg!, var_dump, print_r, dd(. */
export const print: Rule = {
	id: 'print',
	languages: Object.keys(PATTERNS),
	defaultSeverity: 'warning',
	fix: 'removeLine',
	check(line: LineView): RuleMatch[] {
		const matches: RuleMatch[] = [];
		for (const { regex, label } of PATTERNS[line.languageId] ?? []) {
			for (const m of line.code.matchAll(regex)) {
				const name = label(m as RegExpExecArray);
				const start = m.index;
				if (!matches.some((x) => x.start <= start && start < x.end)) {
					matches.push({ start, end: callEnd(line.code, start + m[0].length - 1), message: `${name} left in code`, label: name });
				}
			}
		}
		return matches.sort((a, b) => a.start - b.start);
	},
};
