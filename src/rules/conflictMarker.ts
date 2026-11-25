import type { LineView, Rule, RuleMatch } from '../model';

/** Prose formats where a line of seven `=` can be a heading underline. */
const PROSE = new Set(['markdown', 'plaintext', 'restructuredtext', 'asciidoc']);

/** Lines starting with <<<<<<<, |||||||, ======= or >>>>>>>, as git writes them in a conflict. */
export const conflictMarker: Rule = {
	id: 'conflict-marker',
	languages: '*',
	defaultSeverity: 'error',
	check(line: LineView): RuleMatch[] {
		const text = line.text.replace(/\r$/, '');
		const isMarker =
			/^(<{7}|>{7}|\|{7})(?: |$)/.test(text) || (/^={7}\s*$/.test(text) && !PROSE.has(line.languageId));
		return isMarker ? [{ start: 0, end: text.trimEnd().length, message: 'Merge conflict marker', label: 'conflict marker' }] : [];
	},
};
