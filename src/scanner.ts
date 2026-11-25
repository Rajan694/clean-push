// Runs the rules over the added lines of one file. No VS Code imports.
import type { ActiveRule, AddedLines, Finding, LineView } from './model';
import { syntaxFor } from './languages';
import { lexLines } from './lexer';
import { hasIgnoreComment, type IgnoreMatcher } from './match';

export interface ScanOptions {
	rules: readonly ActiveRule[];
	ignore: IgnoreMatcher;
	/** Marker that skips a line, e.g. "leftover-ignore". Empty to turn it off. */
	ignoreComment: string;
}

/**
 * Finds the leftovers in a file's added lines.
 * @param text the whole file, as saved on disk
 * @param path repository-relative path with `/` separators
 * @param languageId VS Code language id
 */
export function scanText(text: string, path: string, languageId: string, added: AddedLines, options: ScanOptions): Finding[] {
	const rules = options.rules.filter(
		(r) => (r.languages === '*' || r.languages.includes(languageId)) && (!r.appliesToFile || r.appliesToFile(path)),
	);
	if (rules.length === 0 || (added !== 'all' && added.length === 0)) {
		return [];
	}

	const lines = text.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
	const lexed = lexLines(lines, syntaxFor(languageId));
	const findings: Finding[] = [];

	const visit = (n: number) => {
		const textLine = lines[n];
		if (textLine === undefined || hasIgnoreComment(textLine, options.ignoreComment)) {
			return;
		}
		const view: LineView = { text: textLine, ...lexed[n], languageId };
		for (const rule of rules) {
			for (const m of rule.check(view)) {
				if (options.ignore(textLine, m.start, m.end)) {
					continue;
				}
				findings.push({
					line: n,
					start: m.start,
					end: m.end,
					ruleId: rule.id,
					severity: rule.severity,
					message: m.message,
					fix: rule.fix,
				});
			}
		}
	};

	if (added === 'all') {
		lines.forEach((_, n) => visit(n));
	} else {
		for (const range of added) {
			for (let n = range.start; n <= Math.min(range.end, lines.length - 1); n++) {
				visit(n);
			}
		}
	}
	return findings;
}
