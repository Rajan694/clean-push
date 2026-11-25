import type { LineView, Rule, RuleMatch } from '../model';

const KEYWORD = /\b(TODO|FIXME|HACK|XXX)\b/;
const CLOSERS = /\*\/|-->|-\}|\]\]/;

/** New TODO, FIXME, HACK and XXX comments. Only comment text counts, not code or strings. */
export const todo: Rule = {
	id: 'todo',
	languages: '*',
	defaultSeverity: 'info',
	check(line: LineView): RuleMatch[] {
		const m = KEYWORD.exec(line.comments);
		if (!m) {
			return [];
		}
		// Underline from the keyword to the end of its comment, without a closing */ or -->.
		const close = CLOSERS.exec(line.comments.slice(m.index));
		const text = line.comments.slice(m.index, close ? m.index + close.index : undefined).trimEnd();
		return [{ start: m.index, end: m.index + text.length, message: `New ${m[1]} comment`, label: `new ${m[1]}` }];
	},
};
