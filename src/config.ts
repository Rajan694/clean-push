import * as vscode from 'vscode';
import type { ActiveRule, SeveritySetting } from './model';
import type { Scope } from './git/changedFiles';
import { activeRules } from './rules';
import { excludeMatcher, ignoreMatcher, type IgnoreMatcher } from './match';

export const SECTION = 'cleanPush';

/** The `cleanPush.*` settings, read and compiled for one check. */
export interface Settings {
	scope: Scope;
	rules: ActiveRule[];
	ignore: IgnoreMatcher;
	ignoreComment: string;
	isExcluded: (relativePath: string) => boolean;
	maxFileBytes: number;
}

const SCOPES: readonly Scope[] = ['unpushed', 'uncommitted', 'staged'];

export function readSettings(resource: vscode.Uri | undefined, log: vscode.LogOutputChannel): Settings {
	const config = vscode.workspace.getConfiguration(SECTION, resource);
	const scope = config.get<string>('scope', 'unpushed');
	const largeFileKB = config.get<number>('largeFileKB', 1024);
	return {
		scope: SCOPES.includes(scope as Scope) ? (scope as Scope) : 'unpushed',
		rules: activeRules(config.get<Record<string, SeveritySetting>>('rules', {})),
		ignore: ignoreMatcher(config.get<string[]>('ignoreList', []), (entry, error) =>
			log.warn(`cleanPush.ignoreList: skipping invalid regex ${entry}: ${error}`),
		),
		ignoreComment: config.get<string>('ignoreComment', 'leftover-ignore').trim(),
		isExcluded: excludeMatcher(config.get<string[]>('exclude', [])),
		maxFileBytes: Math.max(1, largeFileKB) * 1024,
	};
}
