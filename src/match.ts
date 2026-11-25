// Text and glob matching for settings: cleanPush.ignoreList and cleanPush.exclude.
// No VS Code imports.

/** Tells whether a match on a line is covered by an ignore-list entry. */
export type IgnoreMatcher = (text: string, start: number, end: number) => boolean;

/**
 * Builds the matcher for `cleanPush.ignoreList`. Entries are plain text (`console.warn`) or a
 * regex written as `/…/flags`. A match is ignored when an occurrence of an entry on the line
 * overlaps it, so `console.warn` hides `console.warn("x")` but not a `console.log` next to it.
 * Invalid regexes are reported through `onInvalid` and skipped.
 */
export function ignoreMatcher(entries: readonly string[], onInvalid?: (entry: string, error: string) => void): IgnoreMatcher {
	const regexes: RegExp[] = [];
	for (const entry of entries) {
		if (!entry) {
			continue;
		}
		const literal = /^\/(.+)\/([a-z]*)$/.exec(entry);
		if (literal) {
			try {
				const flags = literal[2].includes('g') ? literal[2] : literal[2] + 'g';
				regexes.push(new RegExp(literal[1], flags));
			} catch (e) {
				onInvalid?.(entry, e instanceof Error ? e.message : String(e));
			}
		} else {
			regexes.push(new RegExp(escapeRegExp(entry), 'g'));
		}
	}
	return (text, start, end) =>
		regexes.some((re) => {
			for (const m of text.matchAll(re)) {
				const mEnd = m.index + Math.max(m[0].length, 1);
				if (m.index < end && start < mEnd) {
					return true;
				}
			}
			return false;
		});
}

/**
 * Whether a line is marked to be skipped: it ends in the marker (`// leftover-ignore`),
 * optionally followed by a comment closer such as `*\/` or `-->`.
 */
export function hasIgnoreComment(text: string, marker: string): boolean {
	if (!marker) {
		return false;
	}
	const re = new RegExp(`${escapeRegExp(marker)}\\s*(?:\\*/|-->|-\\}|\\]\\]|#\\})?\\s*$`);
	return re.test(text);
}

/**
 * Converts a glob as VS Code writes them (`**`, `*`, `?`, `{a,b}`, `[abc]`) into a regex
 * matched against a `/`-separated relative path.
 */
export function globToRegExp(glob: string): RegExp {
	let re = '';
	let braceDepth = 0;
	for (let i = 0; i < glob.length; i++) {
		const ch = glob[i];
		if (ch === '*') {
			if (glob[i + 1] === '*') {
				// `**/` matches zero or more folders; a trailing `**` matches anything.
				if (glob[i + 2] === '/') {
					re += '(?:.*/)?';
					i += 2;
				} else {
					re += '.*';
					i += 1;
				}
			} else {
				re += '[^/]*';
			}
		} else if (ch === '?') {
			re += '[^/]';
		} else if (ch === '{') {
			braceDepth++;
			re += '(?:';
		} else if (ch === '}' && braceDepth > 0) {
			braceDepth--;
			re += ')';
		} else if (ch === ',' && braceDepth > 0) {
			re += '|';
		} else if (ch === '[') {
			const close = glob.indexOf(']', i + 1);
			if (close === -1) {
				re += '\\[';
			} else {
				let body = glob.slice(i + 1, close);
				if (body.startsWith('!')) {
					body = '^' + body.slice(1);
				}
				re += `[${body.replace(/\\/g, '\\\\')}]`;
				i = close;
			}
		} else {
			re += escapeRegExp(ch);
		}
	}
	return new RegExp(`^${re}$`);
}

/** Matcher for `cleanPush.exclude`; a pattern without a `/` matches the file name anywhere. */
export function excludeMatcher(globs: readonly string[]): (relativePath: string) => boolean {
	const regexes = globs.filter(Boolean).map((g) => globToRegExp(g.includes('/') ? g : `**/${g}`));
	return (path) => regexes.some((re) => re.test(path));
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}
