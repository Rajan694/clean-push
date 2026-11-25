import type { ActiveFileRule, ActiveRule, FileRule, Rule, SeveritySetting } from '../model';
import { conflictMarker } from './conflictMarker';
import { consoleRule } from './console';
import { debuggerRule } from './debugger';
import { envFile, largeFile } from './fileRules';
import { focusedTest } from './focusedTest';
import { print } from './print';
import { secret } from './secret';
import { todo } from './todo';

/** Built-in line rules, most severe first. */
export const BUILT_IN_RULES: readonly Rule[] = [conflictMarker, secret, focusedTest, debuggerRule, consoleRule, print, todo];

/** Built-in rules about whole files. */
export const FILE_RULES: readonly FileRule[] = [envFile, largeFile];

type Severities = Readonly<Record<string, SeveritySetting | undefined>>;

function withSeverity<T extends Rule | FileRule>(rules: readonly T[], severities: Severities): (T & { severity: ActiveRule['severity'] })[] {
	const out: (T & { severity: ActiveRule['severity'] })[] = [];
	for (const rule of rules) {
		const setting = severities[rule.id] ?? rule.defaultSeverity;
		if (setting !== 'off') {
			out.push({ ...rule, severity: setting });
		}
	}
	return out;
}

/** The line rules that are on, with the severity from `cleanPush.rules` (or their default). */
export function activeRules(severities: Severities): ActiveRule[] {
	return withSeverity(BUILT_IN_RULES, severities);
}

/** The file rules that are on, with the severity from `cleanPush.rules` (or their default). */
export function activeFileRules(severities: Severities): ActiveFileRule[] {
	return withSeverity(FILE_RULES, severities);
}
