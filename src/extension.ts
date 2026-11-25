import * as vscode from 'vscode';

/**
 * Commands declared in package.json. Each one gets its real handler as its milestone
 * lands (see docs/DESIGN.md, "Milestones"); until then it shows a short notice, so
 * clicking it never fails with "command not found".
 */
const PLANNED_COMMANDS = [
	'cleanPush.openFirstLeftover',
	'cleanPush.fixAllInFile',
	'cleanPush.refresh',
	'cleanPush.changeScope',
	'cleanPush.installHook',
	'cleanPush.uninstallHook',
] as const;

export function activate(context: vscode.ExtensionContext): void {
	const log = vscode.window.createOutputChannel('Clean Push', { log: true });
	context.subscriptions.push(log);
	log.info(`Clean Push ${context.extension.packageJSON.version} activated`);

	for (const id of PLANNED_COMMANDS) {
		context.subscriptions.push(
			vscode.commands.registerCommand(id, () => {
				void vscode.window.showInformationMessage(`Clean Push: "${id}" is not implemented yet.`);
			}),
		);
	}
}

export function deactivate(): void {}
