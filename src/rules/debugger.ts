import type { LineView, Rule, RuleMatch } from '../model';
import { JS_LANGUAGES } from '../languages';

interface Pattern {
	regex: RegExp;
	label: string;
}

const PATTERNS: Record<string, readonly Pattern[]> = {
	// The `debugger` statement; not obj.debugger or { debugger: 1 }.
	js: [{ regex: /(?<![\w$.])debugger(?![\w$])(?!\s*[:(=])\s*;?/, label: 'debugger statement' }],
	python: [
		{ regex: /(?<![\w.])breakpoint\s*\(\s*\)/, label: 'breakpoint()' },
		{ regex: /(?<![\w.])(?:pdb|ipdb|pudb)\s*\.\s*set_trace\s*\([^)]*\)/, label: 'set_trace()' },
		{ regex: /^\s*import\s+(?:pdb|ipdb|pudb)\b/, label: 'import pdb' },
		{ regex: /^\s*from\s+(?:pdb|ipdb|pudb)\s+import\b.*/, label: 'import pdb' },
	],
	ruby: [
		{ regex: /(?<![\w.])binding\s*\.\s*(?:pry|irb|break)\b/, label: 'binding.pry' },
		{ regex: /(?<![\w.:])byebug\b(?!\s*[:=])/, label: 'byebug' },
		{ regex: /^\s*debugger\s*$/, label: 'debugger' },
	],
};

/** `debugger;`, `breakpoint()`, `pdb.set_trace()`, `import pdb`, `binding.pry` and `byebug`. */
export const debuggerRule: Rule = {
	id: 'debugger',
	languages: [...JS_LANGUAGES, 'python', 'ruby'],
	defaultSeverity: 'warning',
	fix: 'removeLine',
	check(line: LineView): RuleMatch[] {
		const patterns = PATTERNS[line.languageId] ?? PATTERNS.js;
		const matches: RuleMatch[] = [];
		for (const { regex, label } of patterns) {
			const m = regex.exec(line.code);
			if (m) {
				const start = m.index + (m[0].length - m[0].trimStart().length);
				const end = m.index + m[0].trimEnd().length;
				if (!matches.some((x) => start < x.end && x.start < end)) {
					matches.push({ start, end, message: `${label} left in code`, label: label === 'debugger statement' ? 'debugger' : label });
				}
			}
		}
		return matches.sort((a, b) => a.start - b.start);
	},
};
