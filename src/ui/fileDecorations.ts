import * as vscode from 'vscode';
import { SECTION } from '../config';
import type { LeftoverStore } from '../store';
import { fileSummary, worstSeverity } from '../summary';
import * as path from 'path';

const COLOR = {
	error: 'list.errorForeground',
	warning: 'list.warningForeground',
} as const;

/**
 * Colors files with leftovers in the Explorer and editor tabs and adds a count badge
 * (`3`, or `9+`). Turned off with cleanPush.decorateExplorer.
 */
export function registerFileDecorations(store: LeftoverStore): vscode.Disposable {
	const changed = new vscode.EventEmitter<vscode.Uri[] | undefined>();
	let decorated: vscode.Uri[] = [];
	const enabled = () => vscode.workspace.getConfiguration(SECTION).get<boolean>('decorateExplorer', true);

	const provider: vscode.FileDecorationProvider = {
		onDidChangeFileDecorations: changed.event,
		provideFileDecoration(uri) {
			if (uri.scheme !== 'file' || !enabled()) {
				return undefined;
			}
			const leftovers = store.get(uri);
			if (leftovers.length === 0) {
				return undefined;
			}
			const worst = worstSeverity(leftovers.map((l) => l.severity));
			const color = worst === 'error' || worst === 'warning' ? new vscode.ThemeColor(COLOR[worst]) : undefined;
			const badge = leftovers.length > 9 ? '9+' : String(leftovers.length);
			return new vscode.FileDecoration(badge, fileSummary(path.basename(uri.fsPath), leftovers.map((l) => l.label)), color);
		},
	};

	const refresh = () => {
		const now = [...store.files()].map(([uri]) => uri);
		changed.fire([...decorated, ...now]);
		decorated = now;
	};

	return vscode.Disposable.from(
		changed,
		vscode.window.registerFileDecorationProvider(provider),
		store.onDidChange(refresh),
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration(`${SECTION}.decorateExplorer`)) {
				changed.fire(undefined);
			}
		}),
	);
}
