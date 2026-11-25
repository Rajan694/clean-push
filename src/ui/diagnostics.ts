import * as vscode from 'vscode';
import type { Leftover, Severity } from '../model';
import type { LeftoverStore } from '../store';

export const DIAGNOSTIC_SOURCE = 'clean-push';

const SEVERITY: Record<Severity, vscode.DiagnosticSeverity> = {
	error: vscode.DiagnosticSeverity.Error,
	warning: vscode.DiagnosticSeverity.Warning,
	info: vscode.DiagnosticSeverity.Information,
};

export function toDiagnostic(leftover: Leftover): vscode.Diagnostic {
	const diagnostic = new vscode.Diagnostic(leftover.range, leftover.message, SEVERITY[leftover.severity]);
	diagnostic.source = DIAGNOSTIC_SOURCE;
	diagnostic.code = leftover.ruleId;
	return diagnostic;
}

/**
 * Mirrors the store into a DiagnosticCollection: squiggles and hovers in the editor, marks on
 * the scrollbar, entries in the Problems panel, and F8 / Shift+F8 navigation.
 */
export function registerDiagnostics(store: LeftoverStore): vscode.Disposable {
	const collection = vscode.languages.createDiagnosticCollection(DIAGNOSTIC_SOURCE);
	let shown = new Map<string, vscode.Uri>();

	const update = () => {
		const next = new Map<string, vscode.Uri>();
		for (const [uri, leftovers] of store.files()) {
			collection.set(uri, leftovers.map(toDiagnostic));
			next.set(uri.toString(), uri);
		}
		for (const [key, uri] of shown) {
			if (!next.has(key)) {
				collection.delete(uri);
			}
		}
		shown = next;
	};

	const sub = store.onDidChange(update);
	update();
	return vscode.Disposable.from(sub, collection);
}
