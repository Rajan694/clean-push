import * as vscode from 'vscode';
import type { ActiveFileRule, ActiveRule, SeveritySetting } from './model';
import type { Scope } from './git/changedFiles';
import { activeFileRules, activeRules } from './rules';
import { customRules } from './rules/custom';
import { excludeMatcher, ignoreMatcher, type IgnoreMatcher } from './match';

export const SECTION = 'cleanPush';

/** The `cleanPush.*` settings, read and compiled for one check. */
export interface Settings {
	scope: Scope;
	rules: ActiveRule[];
	fileRules: ActiveFileRule[];
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
	const severities = config.get<Record<string, SeveritySetting>>('rules', {});
	return {
		scope: SCOPES.includes(scope as Scope) ? (scope as Scope) : 'unpushed',
		rules: [
			...activeRules(severities),
			...customRules(config.get<unknown[]>('customRules', []), (problem) => log.warn(`cleanPush.customRules: ${problem}`)),
		],
		fileRules: activeFileRules(severities),
		ignore: ignoreMatcher(config.get<string[]>('ignoreList', []), (entry, error) =>
			log.warn(`cleanPush.ignoreList: skipping invalid regex ${entry}: ${error}`),
		),
		ignoreComment: config.get<string>('ignoreComment', 'leftover-ignore').trim(),
		isExcluded: excludeMatcher(config.get<string[]>('exclude', [])),
		maxFileBytes: Math.max(1, largeFileKB) * 1024,
	};
}
