import * as vscode from 'vscode';
import { Checker } from './checker';
import { registerCommands } from './commands';
import { getGitApi } from './git/gitApi';
import { LeftoverStore } from './store';
import { registerDiagnostics } from './ui/diagnostics';

export function activate(context: vscode.ExtensionContext): void {
	const log = vscode.window.createOutputChannel('Clean Push', { log: true });
	const store = new LeftoverStore();
	let checker: Checker | undefined;
	let ready: Promise<void> = Promise.resolve();

	context.subscriptions.push(
		log,
		store,
		registerDiagnostics(store),
		registerCommands(async () => {
			await ready;
			await checker?.refresh();
		}),
		{ dispose: () => checker?.dispose() },
	);
	log.info(`Clean Push ${context.extension.packageJSON.version} activated`);

	// The Git API can take a while to be ready; don't hold up activation for it.
	ready = getGitApi(log).then(
		(api) => {
			if (api) {
				checker = new Checker(api, store, log);
			}
		},
		(e) => log.error(`Could not get the Git extension's API: ${e instanceof Error ? e.message : e}`),
	);
}

export function deactivate(): void {}
