import * as vscode from 'vscode';
import { Checker } from './checker';
import { LeftoverCodeActions } from './codeActions';
import { SECTION } from './config';
import { registerCommands } from './commands';
import { getGitApi } from './git/gitApi';
import { LeftoverStore } from './store';
import { registerDiagnostics } from './ui/diagnostics';
import { registerEditorDecorations } from './ui/editorDecorations';
import { registerFileDecorations } from './ui/fileDecorations';
import { LeftoversView } from './ui/leftoversView';
import { registerStatusBar } from './ui/statusBar';

/** Returned from activate() for the extension's own tests; not a stable API for other extensions. */
export interface TestApi {
	store: LeftoverStore;
	leftoversView: LeftoversView;
}

export function activate(context: vscode.ExtensionContext): TestApi {
	const log = vscode.window.createOutputChannel('Clean Push', { log: true });
	const store = new LeftoverStore();
	const leftoversView = new LeftoversView(store);
	let checker: Checker | undefined;
	let ready: Promise<void> = Promise.resolve();

	context.subscriptions.push(
		log,
		store,
		registerDiagnostics(store),
		leftoversView,
		registerStatusBar(store),
		registerEditorDecorations(store, context.extensionUri),
		registerFileDecorations(store),
		vscode.languages.registerCodeActionsProvider(
			{ scheme: 'file' },
			new LeftoverCodeActions(store, (uri) =>
				vscode.workspace.getConfiguration(SECTION, uri).get<string>('ignoreComment', 'leftover-ignore').trim(),
			),
			LeftoverCodeActions.metadata,
		),
		registerCommands(store, async () => {
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
	return { store, leftoversView };
}

export function deactivate(): void {}
