// Quick-fix edits for leftovers, computed on plain lines of text. No VS Code imports.
//
// A removal is only made when it can't break the code: the leftover must be a whole
// statement (nothing but `;`, `{` or `}` before it, nothing but a `}` or a new statement
// after its `;`). Then the whole line goes if nothing else is on it, otherwise just the call.
import type { FixKind } from './model';
import type { LexedLine } from './lexer';
import { syntaxFor } from './languages';

export interface FixTarget {
	line: number;
	start: number;
	end: number;
	ruleId: string;
	fix?: FixKind;
	/** The line as it was scanned; the fix is skipped if the line has changed since. */
	text?: string;
}

/** Lines of a file plus their code view, edited together so offsets stay in step. */
interface Buffer {
	text: string[];
	code: string[];
}

export interface FixResult {
	lines: string[];
	/** How many targets were fixed. */
	applied: number;
}

/** Longest multi-line call a removal will follow, in lines. */
const MAX_CALL_LINES = 200;

/**
 * Applies the fixes for `targets` to a copy of `lines`. Targets without a fix, with a line
 * that has changed, or whose removal isn't safe are left alone.
 */
export function applyFixes(lines: readonly string[], lexed: readonly LexedLine[], languageId: string, targets: readonly FixTarget[]): FixResult {
	const buf: Buffer = { text: [...lines], code: lexed.map((l) => l.code) };
	// Bottom-up and right-to-left, so each fix leaves the positions of the ones still to do alone.
	const ordered = targets
		.filter((t) => t.fix && (t.text === undefined || lines[t.line] === t.text))
		.sort((a, b) => b.line - a.line || b.start - a.start);
	let applied = 0;
	for (const target of ordered) {
		const done = target.fix === 'removeMatch' ? removeFocus(buf, target) : target.fix === 'removeLine' ? removeStatement(buf, target, languageId) : false;
		if (done) {
			applied++;
		}
	}
	return { lines: buf.text, applied };
}

/** Title for a target's quick fix, e.g. "Remove console.log" or "Change fit to it". */
export function fixTitle(target: FixTarget, lineText: string, label: string): string {
	if (target.fix === 'removeMatch') {
		const matched = lineText.slice(target.start, target.end);
		const focused = /^f(describe|context|it|test)$/.exec(matched);
		return focused ? `Change ${matched} to ${focused[1]}` : 'Remove .only';
	}
	return `Remove ${label}`;
}

/** `.only` → removed; `fit` / `fdescribe` / `fcontext` / `ftest` → the `f` removed. */
function removeFocus(buf: Buffer, t: FixTarget): boolean {
	const matched = buf.text[t.line].slice(t.start, t.end);
	const only = /\s*\.\s*only$/.exec(matched);
	if (only) {
		splice(buf, t.line, t.start + only.index, t.end);
		return true;
	}
	if (/^f(describe|context|it|test)$/.test(matched)) {
		splice(buf, t.line, t.start, t.start + 1);
		return true;
	}
	return false;
}

/** Removes a statement such as `console.log(x);`, `debugger;` or `breakpoint()` if that is safe. */
function removeStatement(buf: Buffer, t: FixTarget, languageId: string): boolean {
	const extent = statementEnd(buf, t);
	if (!extent) {
		return false;
	}
	let { line: endLine, char: endChar } = extent;
	let consumedSemicolon = buf.code[endLine].slice(0, endChar).trimEnd().endsWith(';');
	const semi = /^\s*;/.exec(buf.code[endLine].slice(endChar));
	if (!consumedSemicolon && semi) {
		endChar += semi[0].length;
		consumedSemicolon = true;
	}

	const before = buf.code[t.line].slice(0, t.start).trim();
	const after = buf.code[endLine].slice(endChar).trim();
	const beforeOk = before === '' || /[;{}]$/.test(before);
	const afterOk = after === '' || after.startsWith('}') || consumedSemicolon;
	if (!beforeOk || !afterOk) {
		return false;
	}

	if (before === '' && after === '') {
		// No other code on these lines: remove them, with any comment about the leftover.
		// In Python a block can't be empty, so a lone statement in a block becomes `pass`.
		if (languageId === 'python' && blockWouldBeEmpty(buf, t.line, endLine)) {
			const indent = /^\s*/.exec(buf.text[t.line])![0];
			replaceLines(buf, t.line, endLine, [indent + 'pass']);
		} else {
			replaceLines(buf, t.line, endLine, []);
		}
		return true;
	}

	let from = t.start;
	let to = endChar;
	if (after === '') {
		// Leftover at the end of the code: also take the spaces before it.
		while (from > 0 && /\s/.test(buf.text[t.line][from - 1])) {
			from--;
		}
	} else {
		// Code follows: take the spaces after it instead.
		while (to < buf.text[endLine].length && /\s/.test(buf.text[endLine][to])) {
			to++;
		}
	}
	removeSpan(buf, t.line, from, endLine, to);
	return true;
}

/**
 * Where the leftover's statement ends: after the matching `)` when the match is a call that
 * continues onto later lines, else at the end of the match.
 */
function statementEnd(buf: Buffer, t: FixTarget): { line: number; char: number } | undefined {
	const code = buf.code[t.line];
	const open = code.indexOf('(', t.start);
	if (open === -1 || open >= t.end) {
		return { line: t.line, char: t.end };
	}
	let depth = 0;
	for (let line = t.line; line < Math.min(buf.code.length, t.line + MAX_CALL_LINES); line++) {
		const c = buf.code[line];
		for (let i = line === t.line ? open : 0; i < c.length; i++) {
			if (c[i] === '(') {
				depth++;
			} else if (c[i] === ')' && --depth === 0) {
				return { line, char: i + 1 };
			}
		}
	}
	return undefined;
}

function blockWouldBeEmpty(buf: Buffer, from: number, to: number): boolean {
	const indent = (line: number) => /^\s*/.exec(buf.text[line])![0].length;
	let prev = from - 1;
	while (prev >= 0 && buf.code[prev].trim() === '') {
		prev--;
	}
	if (prev < 0 || !buf.code[prev].trimEnd().endsWith(':')) {
		return false;
	}
	let next = to + 1;
	while (next < buf.code.length && buf.code[next].trim() === '') {
		next++;
	}
	return next >= buf.code.length || indent(next) <= indent(prev);
}

function splice(buf: Buffer, line: number, from: number, to: number): void {
	buf.text[line] = buf.text[line].slice(0, from) + buf.text[line].slice(to);
	buf.code[line] = buf.code[line].slice(0, from) + buf.code[line].slice(to);
}

function removeSpan(buf: Buffer, line: number, from: number, endLine: number, to: number): void {
	const join = (rows: string[]) => rows[line].slice(0, from) + rows[endLine].slice(to);
	const text = join(buf.text);
	const code = join(buf.code);
	buf.text.splice(line, endLine - line + 1, text);
	buf.code.splice(line, endLine - line + 1, code);
}

function replaceLines(buf: Buffer, from: number, to: number, lines: string[]): void {
	buf.text.splice(from, to - from + 1, ...lines);
	buf.code.splice(from, to - from + 1, ...lines);
}

/**
 * Text to append to a line so the scanner skips it, e.g. ` // leftover-ignore`, or just
 * ` leftover-ignore` when the line already ends in a line comment. Undefined when the
 * language has no comments or the line ends inside a string.
 */
export function ignoreSuffix(text: string, lexed: LexedLine, languageId: string, marker: string): string | undefined {
	const end = text.trimEnd().length;
	if (!marker || end === 0) {
		return undefined;
	}
	const inCode = lexed.code[end - 1] !== ' ';
	const inComment = lexed.comments[end - 1] !== ' ';
	if (!inCode && !inComment) {
		return undefined; // the line ends inside a string
	}
	const syntax = syntaxFor(languageId);
	const endsBlock = syntax.block.some(([, close]) => text.trimEnd().endsWith(close));
	if (inComment && !endsBlock) {
		return ` ${marker}`;
	}
	if (syntax.line.length > 0) {
		return ` ${syntax.line[0].trim()} ${marker}`;
	}
	if (syntax.block.length > 0) {
		const [open, close] = syntax.block[0];
		return ` ${open} ${marker} ${close}`;
	}
	return undefined;
}
