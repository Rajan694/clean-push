// Parses `git diff -U0` output into the lines each file added. No VS Code imports.
import type { LineRange } from '../model';

/** One `@@ -a,b +c,d @@` hunk header, numbers as git prints them (1-based). */
export interface Hunk {
	oldStart: number;
	oldCount: number;
	newStart: number;
	newCount: number;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Splits a patch into hunks per file. Keys are the new-side paths relative to the
 * repository root; deleted files (`+++ /dev/null`) are left out. Expects the patch to be
 * made with `--src-prefix=a/ --dst-prefix=b/`.
 */
export function parseUnifiedDiff(patch: string): Map<string, Hunk[]> {
	const files = new Map<string, Hunk[]>();
	let current: Hunk[] | undefined;
	for (const raw of patch.split('\n')) {
		const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
		if (line.startsWith('diff --git ')) {
			current = undefined;
		} else if (line.startsWith('+++ ')) {
			const path = parsePatchPath(line.slice(4));
			if (path === undefined) {
				current = undefined;
			} else {
				current = files.get(path) ?? [];
				files.set(path, current);
			}
		} else if (current && line.startsWith('@@ ')) {
			const m = HUNK_HEADER.exec(line);
			if (m) {
				current.push({
					oldStart: Number(m[1]),
					oldCount: m[2] === undefined ? 1 : Number(m[2]),
					newStart: Number(m[3]),
					newCount: m[4] === undefined ? 1 : Number(m[4]),
				});
			}
		}
	}
	return files;
}

/** The lines a file's hunks add, as 0-based inclusive ranges in the new file. */
export function addedRanges(hunks: readonly Hunk[]): LineRange[] {
	const ranges: LineRange[] = [];
	for (const h of hunks) {
		if (h.newCount > 0) {
			ranges.push({ start: h.newStart - 1, end: h.newStart + h.newCount - 2 });
		}
	}
	return mergeRanges(ranges);
}

/**
 * Moves line ranges of an old file to where they are in the new file, given the hunks
 * between the two. Lines that a hunk changes or removes are dropped.
 *
 * Used by the `staged` scope: lines added in the index are mapped through the
 * index → working tree diff, because the scanner reads the working tree file.
 */
export function mapThroughHunks(ranges: readonly LineRange[], hunks: readonly Hunk[]): LineRange[] {
	// Each hunk as a 0-based half-open range [from, to) of old lines plus the line shift after it.
	const spans = hunks
		.map((h) => {
			const from = h.oldCount === 0 ? h.oldStart : h.oldStart - 1;
			return { from, to: from + h.oldCount, delta: h.newCount - h.oldCount };
		})
		.sort((a, b) => a.from - b.from);

	const out: LineRange[] = [];
	for (const range of ranges) {
		for (let line = range.start; line <= range.end; line++) {
			let shift = 0;
			let dropped = false;
			for (const s of spans) {
				if (s.from <= line && line < s.to) {
					dropped = true;
					break;
				}
				if (s.to <= line) {
					shift += s.delta;
				} else {
					break;
				}
			}
			if (!dropped) {
				out.push({ start: line + shift, end: line + shift });
			}
		}
	}
	return mergeRanges(out);
}

/** Sorts ranges and joins the ones that touch or overlap. */
export function mergeRanges(ranges: readonly LineRange[]): LineRange[] {
	const sorted = [...ranges].sort((a, b) => a.start - b.start);
	const out: LineRange[] = [];
	for (const r of sorted) {
		const last = out[out.length - 1];
		if (last && r.start <= last.end + 1) {
			last.end = Math.max(last.end, r.end);
		} else {
			out.push({ ...r });
		}
	}
	return out;
}

/** Path from a `+++ ` line, without the `b/` prefix; undefined for /dev/null. */
function parsePatchPath(field: string): string | undefined {
	// Git ends the name with a tab when it contains a space.
	let name = field.endsWith('\t') ? field.slice(0, -1) : field;
	if (name === '/dev/null') {
		return undefined;
	}
	if (name.startsWith('"')) {
		name = unquoteGitPath(name);
	}
	return name.startsWith('b/') ? name.slice(2) : name;
}

const C_ESCAPES: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 };

/** Decodes a path git wrote as a C-style quoted string, e.g. "b/caf\303\251.ts". */
export function unquoteGitPath(quoted: string): string {
	const body = quoted.startsWith('"') && quoted.endsWith('"') ? quoted.slice(1, -1) : quoted;
	const bytes: number[] = [];
	for (let i = 0; i < body.length; i++) {
		if (body[i] !== '\\') {
			const ch = String.fromCodePoint(body.codePointAt(i)!);
			bytes.push(...Buffer.from(ch, 'utf8'));
			i += ch.length - 1;
			continue;
		}
		const next = body[i + 1];
		if (next !== undefined && /[0-7]/.test(next)) {
			const octal = /^[0-7]{1,3}/.exec(body.slice(i + 1))![0];
			bytes.push(parseInt(octal, 8));
			i += octal.length;
		} else if (next !== undefined && next in C_ESCAPES) {
			bytes.push(C_ESCAPES[next]);
			i++;
		} else {
			bytes.push(92);
		}
	}
	return Buffer.from(bytes).toString('utf8');
}
