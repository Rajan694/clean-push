// Shared types. The rule engine (everything outside ui/, git/gitApi.ts and extension.ts)
// must not load the `vscode` module at runtime, so only type imports from it are allowed here.
import type * as vscode from 'vscode';

export type Severity = 'error' | 'warning' | 'info';
export type SeveritySetting = Severity | 'off';

/** A block of lines, 0-based and inclusive at both ends. */
export interface LineRange {
	start: number;
	end: number;
}

/** Which lines of a file count as added: some ranges, or every line (new and untracked files). */
export type AddedLines = LineRange[] | 'all';

/** How a leftover can be fixed (quick fixes arrive in v0.3). */
export type FixKind = 'removeLine' | 'removeMatch' | 'addToGitignore';

/** One line, as the rules see it. `code` and `comments` have the same length as `text`. */
export interface LineView {
	/** The line as written. */
	text: string;
	/** The line with comments and the contents of strings blanked out with spaces. */
	code: string;
	/** Only the comment text of the line; everything else blanked out with spaces. */
	comments: string;
	languageId: string;
}

/** Where a rule matched on a line: character offsets into the line, end exclusive. */
export interface RuleMatch {
	start: number;
	end: number;
	message: string;
	/** Short name for lists and summaries, e.g. "console.log" or "new TODO". */
	label: string;
}

export interface Rule {
	/** Id used in settings, e.g. "console". */
	id: string;
	/** VS Code language ids the rule runs on, or '*' for every language. */
	languages: readonly string[] | '*';
	defaultSeverity: Severity;
	/** Extra filter on the file path (repository-relative, `/` separators). */
	appliesToFile?(path: string): boolean;
	/** Every leftover on the line; usually none or one. */
	check(line: LineView): RuleMatch[];
	fix?: FixKind;
}

/** A rule with the severity the user's settings give it. */
export interface ActiveRule extends Rule {
	severity: Severity;
}

/** What file-level rules know about a changed file. */
export interface FileInfo {
	/** Repository-relative path with `/` separators. */
	path: string;
	sizeBytes: number;
	/** Added in the scope (new or untracked), not just changed. */
	isNew: boolean;
	/** cleanPush.largeFileKB in bytes. */
	largeFileBytes: number;
}

/** A rule about a whole file (its name or size) rather than its lines. */
export interface FileRule {
	id: string;
	defaultSeverity: Severity;
	check(file: FileInfo): { message: string; label: string } | undefined;
	fix?: FixKind;
}

export interface ActiveFileRule extends FileRule {
	severity: Severity;
}

/** A leftover found by the scanner, in plain line/character terms. */
export interface Finding {
	/** 0-based line number. */
	line: number;
	start: number;
	end: number;
	ruleId: string;
	severity: Severity;
	message: string;
	label: string;
	/** The whole line, for showing the leftover in context. */
	text: string;
	fix?: FixKind;
}

/** A finding tied to a file, ready for the views. */
export interface Leftover {
	uri: vscode.Uri;
	range: vscode.Range;
	ruleId: string;
	severity: Severity;
	message: string;
	label: string;
	/** The whole line, for showing the leftover in context. */
	lineText: string;
	fix?: FixKind;
}
