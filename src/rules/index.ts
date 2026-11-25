import type { ActiveRule, Rule, SeveritySetting } from '../model';
import { conflictMarker } from './conflictMarker';
import { consoleRule } from './console';
import { debuggerRule } from './debugger';
import { focusedTest } from './focusedTest';
import { todo } from './todo';

/** Built-in rules, most severe first. secret, env-file, print and large-file arrive in v0.4. */
export const BUILT_IN_RULES: readonly Rule[] = [conflictMarker, focusedTest, debuggerRule, consoleRule, todo];

/** The rules that are on, with the severity from `cleanPush.rules` (or their default). */
export function activeRules(severities: Readonly<Record<string, SeveritySetting | undefined>>): ActiveRule[] {
	const out: ActiveRule[] = [];
	for (const rule of BUILT_IN_RULES) {
		const setting = severities[rule.id] ?? rule.defaultSeverity;
		if (setting !== 'off') {
			out.push({ ...rule, severity: setting });
		}
	}
	return out;
}
