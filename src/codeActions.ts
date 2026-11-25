import * as vscode from 'vscode';
import { applyFixes, fixTitle, ignoreSuffix, type FixTarget } from './fixes';
import { syntaxFor } from './languages';
import { lexLines, type LexedLine } from './lexer';
import type { Leftover } from './model';
import type { LeftoverStore } from './store';
import { DIAGNOSTIC_SOURCE } from './ui/diagnostics';

/** A document split into lines and lexed, cached per document version. */
interface Lexed {
	uri: string;
	version: number;
	eol: string;
	lines: string[];
	lexed: LexedLine[];
}

let lastLexed: Lexed | undefined;

function lexDocument(document: vscode.TextDocument): Lexed {
	const uri = document.uri.toString();
	if (lastLexed && lastLexed.uri === uri && lastLexed.version === document.version) {
		return lastLexed;
	}
	const lines = document.getText().split(/\r?\n/);
	lastLexed = {
		uri,
		version: document.version,
		eol: document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n',
		lines,
		lexed: lexLines(lines, syntaxFor(document.languageId)),
	};
	return lastLexed;
}

function toTarget(l: Leftover): FixTarget {
	return { line: l.range.start.line, start: l.range.start.character, end: l.range.end.character, ruleId: l.ruleId, fix: l.fix, text: l.lineText };
}

/**
 * One edit that turns the document's lines into `next`: replaces only the lines between the
 * unchanged start and end, so the cursor and folding elsewhere stay put.
 */
function minimalEdit(doc: Lexed, next: string[]): vscode.TextEdit | undefined {
	const old = doc.lines;
	let head = 0;
	while (head < old.length && head < next.length && old[head] === next[head]) {
		head++;
	}
	let tail = 0;
	while (tail < old.length - head && tail < next.length - head && old[old.length - 1 - tail] === next[next.length - 1 - tail]) {
		tail++;
	}
	if (head === old.length && head === next.length) {
		return undefined;
	}
	const middle = next.slice(head, next.length - tail);
	const oldEnd = old.length - tail;
	if (oldEnd < old.length) {
		const range = new vscode.Range(head, 0, oldEnd, 0);
		return vscode.TextEdit.replace(range, middle.map((l) => l + doc.eol).join(''));
	}
	const last = old.length - 1;
	return vscode.TextEdit.replace(new vscode.Range(head, 0, last, old[last].length), middle.join(doc.eol));
}

export interface FixAllResult {
	edit?: vscode.TextEdit;
	applied: number;
}

/** The edit that fixes every safely fixable leftover in a document. */
export function fixAllEdit(document: vscode.TextDocument, leftovers: readonly Leftover[]): FixAllResult {
	const doc = lexDocument(document);
	const result = applyFixes(doc.lines, doc.lexed, document.languageId, leftovers.map(toTarget));
	return { edit: result.applied > 0 ? minimalEdit(doc, result.lines) : undefined, applied: result.applied };
}

/**
 * Lightbulb fixes on leftovers: remove it (when that's safe), ignore the line, or remove
 * every leftover in the file.
 */
export class LeftoverCodeActions implements vscode.CodeActionProvider {
	static readonly metadata: vscode.CodeActionProviderMetadata = {
		providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
	};

	constructor(
		private readonly store: LeftoverStore,
		private readonly ignoreMarker: (uri: vscode.Uri) => string,
	) {}

	provideCodeActions(document: vscode.TextDocument, _range: vscode.Range, context: vscode.CodeActionContext): vscode.CodeAction[] {
		const diagnostics = context.diagnostics.filter((d) => d.source === DIAGNOSTIC_SOURCE);
		if (diagnostics.length === 0) {
			return [];
		}
		const leftovers = this.store.get(document.uri);
		const doc = lexDocument(document);
		const marker = this.ignoreMarker(document.uri);
		const actions: vscode.CodeAction[] = [];
		const ignoredLines = new Set<number>();

		for (const diagnostic of diagnostics) {
			const leftover = leftovers.find(
				(l) => l.ruleId === diagnostic.code && l.range.isEqual(diagnostic.range),
			);
			const line = diagnostic.range.start.line;
			if (!leftover || (leftover.lineText !== '' && doc.lines[line] !== leftover.lineText)) {
				continue; // the line changed since it was checked
			}

			if (leftover.fix) {
				const result = applyFixes(doc.lines, doc.lexed, document.languageId, [toTarget(leftover)]);
				const edit = result.applied > 0 ? minimalEdit(doc, result.lines) : undefined;
				if (edit) {
					const action = new vscode.CodeAction(fixTitle(toTarget(leftover), leftover.lineText, leftover.label), vscode.CodeActionKind.QuickFix);
					action.edit = new vscode.WorkspaceEdit();
					action.edit.set(document.uri, [edit]);
					action.diagnostics = [diagnostic];
					action.isPreferred = true;
					actions.push(action);
				}
			}

			if (leftover.fix === 'addToGitignore') {
				const action = new vscode.CodeAction('Add to .gitignore', vscode.CodeActionKind.QuickFix);
				action.command = { command: 'cleanPush.addToGitignore', title: action.title, arguments: [document.uri] };
				action.diagnostics = [diagnostic];
				action.isPreferred = true;
				actions.push(action);
				continue; // ignoring a line doesn't help with a file-level leftover
			}

			if (leftover.ruleId !== 'conflict-marker' && !ignoredLines.has(line)) {
				const suffix = ignoreSuffix(doc.lines[line], doc.lexed[line], document.languageId, marker);
				if (suffix) {
					ignoredLines.add(line);
					const text = doc.lines[line];
					const end = text.trimEnd().length;
					const action = new vscode.CodeAction(`Ignore this line (${suffix.trim()})`, vscode.CodeActionKind.QuickFix);
					action.edit = new vscode.WorkspaceEdit();
					action.edit.replace(document.uri, new vscode.Range(line, end, line, text.length), suffix);
					action.diagnostics = diagnostics.filter((d) => d.range.start.line === line);
					actions.push(action);
				}
			}
		}

		if (leftovers.filter((l) => l.fix === 'removeLine' || l.fix === 'removeMatch').length > 1 && actions.length > 0) {
			const action = new vscode.CodeAction('Remove all leftovers in this file', vscode.CodeActionKind.QuickFix);
			action.command = { command: 'cleanPush.fixAllInFile', title: action.title, arguments: [document.uri] };
			actions.push(action);
		}
		return actions;
	}
}
