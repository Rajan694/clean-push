import * as vscode from 'vscode';
import type { API, GitExtension } from './git';

/**
 * Gets the built-in Git extension's API once it is ready. Resolves with undefined when the
 * Git extension is missing; waits while it is disabled (`git.enabled: false`).
 */
export async function getGitApi(log: vscode.LogOutputChannel): Promise<API | undefined> {
	const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
	if (!extension) {
		log.warn('The built-in Git extension (vscode.git) is not available; Clean Push stays idle.');
		return undefined;
	}
	const git = extension.isActive ? extension.exports : await extension.activate();

	if (!git.enabled) {
		log.info('The Git extension is disabled (git.enabled is false); waiting for it to be enabled.');
		await new Promise<void>((resolve) => {
			const sub = git.onDidChangeEnablement((enabled) => {
				if (enabled) {
					sub.dispose();
					resolve();
				}
			});
		});
	}

	const api = git.getAPI(1);
	if (api.state !== 'initialized') {
		await new Promise<void>((resolve) => {
			const sub = api.onDidChangeState((state) => {
				if (state === 'initialized') {
					sub.dispose();
					resolve();
				}
			});
		});
	}
	return api;
}
