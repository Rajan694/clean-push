// Splits each line of a file into code and comment text, so rules can skip comments and
// strings. A light tokenizer, not a parser: it knows each language's comment markers and
// string quotes, which is enough for finding leftovers. No VS Code imports.
import type { Syntax, StringSyntax } from './languages';

export interface LexedLine {
	/** The line with comments and string contents replaced by spaces. */
	code: string;
	/** Only the comment text of the line; everything else replaced by spaces. */
	comments: string;
}

type State =
	| { kind: 'code' }
	| { kind: 'block'; close: string }
	| { kind: 'string'; syntax: StringSyntax };

/**
 * Lexes every line of a file. Block comments and multi-line strings carry over to the
 * next line, so the whole file is lexed even when only a few lines are checked.
 */
export function lexLines(lines: readonly string[], syntax: Syntax): LexedLine[] {
	// Longest markers first, so `"""` wins over `"` and `--[[` over `--`.
	const blocks = [...syntax.block].sort((a, b) => b[0].length - a[0].length);
	const lineMarkers = [...syntax.line].sort((a, b) => b.length - a.length);
	const strings = [...syntax.strings].sort((a, b) => b.open.length - a.open.length);

	let state: State = { kind: 'code' };
	const out: LexedLine[] = [];

	for (const text of lines) {
		const code = new Array<string>(text.length);
		const comments = new Array<string>(text.length);
		const put = (from: number, to: number, as: 'code' | 'comment' | 'blank') => {
			for (let k = from; k < to; k++) {
				code[k] = as === 'code' ? text[k] : ' ';
				comments[k] = as === 'comment' ? text[k] : ' ';
			}
		};

		let i = 0;
		while (i < text.length) {
			if (state.kind === 'block') {
				const end = text.indexOf(state.close, i);
				if (end === -1) {
					put(i, text.length, 'comment');
					i = text.length;
				} else {
					put(i, end + state.close.length, 'comment');
					i = end + state.close.length;
					state = { kind: 'code' };
				}
				continue;
			}

			if (state.kind === 'string') {
				const s = state.syntax;
				if (s.escapes && text[i] === '\\') {
					put(i, Math.min(i + 2, text.length), 'blank');
					i += 2;
				} else if (text.startsWith(s.close, i)) {
					put(i, i + s.close.length, 'code');
					i += s.close.length;
					state = { kind: 'code' };
				} else {
					put(i, i + 1, 'blank');
					i++;
				}
				continue;
			}

			const block = blocks.find(([open]) => text.startsWith(open, i));
			if (block) {
				put(i, i + block[0].length, 'comment');
				i += block[0].length;
				state = { kind: 'block', close: block[1] };
				continue;
			}
			if (lineMarkers.some((m) => text.startsWith(m, i))) {
				put(i, text.length, 'comment');
				i = text.length;
				continue;
			}
			const str = strings.find((s) => text.startsWith(s.open, i));
			if (str) {
				put(i, i + str.open.length, 'code');
				i += str.open.length;
				state = { kind: 'string', syntax: str };
				continue;
			}
			put(i, i + 1, 'code');
			i++;
		}

		// A string that can't span lines ends at the end of its line, even if unclosed.
		if (state.kind === 'string' && !state.syntax.multiline) {
			state = { kind: 'code' };
		}
		out.push({ code: code.join(''), comments: comments.join('') });
	}
	return out;
}
