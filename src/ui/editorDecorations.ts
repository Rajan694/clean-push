import * as vscode from 'vscode';
import type { Severity } from '../model';
import type { LeftoverStore } from '../store';
import { severityRank } from '../summary';

/**
 * A gutter icon on each line with a leftover, and a faint background on error and warning
 * lines. Scrollbar marks come from the diagnostics.
 */
export function registerEditorDecorations(store: LeftoverStore, extensionUri: vscode.Uri): vscode.Disposable {
	const icon = (name: string) => vscode.Uri.joinPath(extensionUri, 'assets', `gutter-${name}.svg`);
	const types: Record<Severity, vscode.TextEditorDecorationType> = {
		error: vscode.window.createTextEditorDecorationType({
			isWholeLine: true,
			gutterIconPath: icon('error'),
			gutterIconSize: 'contain',
			backgroundColor: new vscode.ThemeColor('cleanPush.errorLineBackground'),
		}),
		warning: vscode.window.createTextEditorDecorationType({
			isWholeLine: true,
			gutterIconPath: icon('warning'),
			gutterIconSize: 'contain',
			backgroundColor: new vscode.ThemeColor('cleanPush.warningLineBackground'),
		}),
		info: vscode.window.createTextEditorDecorationType({
			isWholeLine: true,
			gutterIconPath: icon('info'),
			gutterIconSize: 'contain',
		}),
	};

	const decorate = (editor: vscode.TextEditor) => {
		// One decoration per line, in the color of the line's most severe leftover.
		const worst = new Map<number, Severity>();
		for (const l of store.get(editor.document.uri)) {
			const line = l.range.start.line;
			const current = worst.get(line);
			if (current === undefined || severityRank(l.severity) < severityRank(current)) {
				worst.set(line, l.severity);
			}
		}
		for (const severity of ['error', 'warning', 'info'] as const) {
			const ranges = [...worst].filter(([, s]) => s === severity).map(([line]) => new vscode.Range(line, 0, line, 0));
			editor.setDecorations(types[severity], ranges);
		}
	};
	const decorateAll = () => vscode.window.visibleTextEditors.forEach(decorate);

	decorateAll();
	return vscode.Disposable.from(
		store.onDidChange(decorateAll),
		vscode.window.onDidChangeVisibleTextEditors(decorateAll),
		...Object.values(types),
	);
}
