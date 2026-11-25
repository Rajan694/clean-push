// Helpers shared by the rules. No VS Code imports.

/**
 * End of a call whose `(` is at `openParen`: the index just past the matching `)` and an
 * optional `;`. Pass the code view of the line, so parentheses inside strings and comments
 * are already blanked out. A call that continues on the next line runs to the end of the line.
 */
export function callEnd(code: string, openParen: number): number {
	let depth = 0;
	for (let i = openParen; i < code.length; i++) {
		const ch = code[i];
		if (ch === '(') {
			depth++;
		} else if (ch === ')') {
			depth--;
			if (depth === 0) {
				let end = i + 1;
				const semi = /^\s*;/.exec(code.slice(end));
				if (semi) {
					end += semi[0].length;
				}
				return end;
			}
		}
	}
	return code.trimEnd().length;
}

/** Whether a path (repository-relative, `/` separators) looks like a test file. */
export function isTestFile(path: string): boolean {
	const lower = path.toLowerCase();
	const base = lower.slice(lower.lastIndexOf('/') + 1);
	if (/[._-](test|spec|e2e|cy)\.[cm]?[jt]sx?$/.test(base)) {
		return true;
	}
	const dirs = lower.split('/').slice(0, -1);
	return dirs.some((d) => d === 'test' || d === 'tests' || d === '__tests__' || d === 'spec' || d === 'specs' || d === 'e2e' || d === 'cypress');
}
