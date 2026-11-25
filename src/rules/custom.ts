import type { ActiveRule, LineView, RuleMatch, Severity } from '../model';

const SEVERITIES: readonly Severity[] = ['error', 'warning', 'info'];

/**
 * Builds rules from cleanPush.customRules. Each pattern is matched against the raw text of
 * every added line. Entries with a missing id, pattern or message, or an invalid regex, are
 * reported through `onInvalid` and skipped.
 */
export function customRules(entries: readonly unknown[], onInvalid: (problem: string) => void): ActiveRule[] {
	const rules: ActiveRule[] = [];
	entries.forEach((entry, index) => {
		const e = (entry ?? {}) as Record<string, unknown>;
		const where = typeof e.id === 'string' && e.id ? `"${e.id}"` : `#${index + 1}`;
		if (typeof e.id !== 'string' || !e.id || typeof e.pattern !== 'string' || !e.pattern || typeof e.message !== 'string') {
			onInvalid(`custom rule ${where} needs an id, a pattern and a message`);
			return;
		}
		let regex: RegExp;
		try {
			regex = new RegExp(e.pattern, 'g');
		} catch (error) {
			onInvalid(`custom rule ${where} has an invalid pattern: ${error instanceof Error ? error.message : error}`);
			return;
		}
		const languages = Array.isArray(e.languages) && e.languages.length > 0 ? e.languages.filter((l): l is string => typeof l === 'string') : '*';
		const severity = SEVERITIES.includes(e.severity as Severity) ? (e.severity as Severity) : 'warning';
		const id = e.id;
		const message = e.message;
		rules.push({
			id,
			languages,
			defaultSeverity: severity,
			severity,
			check(line: LineView): RuleMatch[] {
				return [...line.text.matchAll(regex)]
					.filter((m) => m[0].length > 0)
					.map((m) => ({ start: m.index, end: m.index + m[0].length, message, label: id }));
			},
		});
	});
	return rules;
}
