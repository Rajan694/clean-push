import * as vscode from 'vscode';
import type { Severity } from '../model';
import type { LeftoverStore } from '../store';
import { plural, severityCounts, totalSummary, worstSeverity } from '../summary';
import { VIEW_ID } from './leftoversView';

const ICON: Record<Severity, string> = { error: '$(error)', warning: '$(warning)', info: '$(info)' };

/** "⚠ 4 leftovers" in the status bar; clicking it focuses the Leftovers section. Hidden when there are none. */
export function registerStatusBar(store: LeftoverStore): vscode.Disposable {
	const item = vscode.window.createStatusBarItem('cleanPush.status', vscode.StatusBarAlignment.Left, 0);
	item.name = 'Clean Push';
	item.command = { command: `${VIEW_ID}.focus`, title: 'Show Leftovers' };

	const update = () => {
		const severities: Severity[] = [];
		let files = 0;
		for (const [, leftovers] of store.files()) {
			files++;
			severities.push(...leftovers.map((l) => l.severity));
		}
		if (severities.length === 0) {
			item.hide();
			return;
		}
		item.text = `${ICON[worstSeverity(severities)!]} ${plural(severities.length, 'leftover')}`;
		item.tooltip = `Clean Push: ${totalSummary(severities.length, files)} (${severityCounts(severities)}). Click to show them.`;
		item.accessibilityInformation = { label: `Clean Push: ${plural(severities.length, 'leftover')}`, role: 'button' };
		item.show();
	};

	const sub = store.onDidChange(update);
	update();
	return vscode.Disposable.from(sub, item);
}
