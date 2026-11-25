// Wording for counts and summaries shown in the views. No VS Code imports.
import type { Severity } from './model';

const RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

/** "1 leftover", "3 leftovers". */
export function plural(count: number, word: string, pluralWord = `${word}s`): string {
	return `${count} ${count === 1 ? word : pluralWord}`;
}

/** The most severe of the given severities, or undefined for none. */
export function worstSeverity(severities: Iterable<Severity>): Severity | undefined {
	let worst: Severity | undefined;
	for (const s of severities) {
		if (worst === undefined || RANK[s] < RANK[worst]) {
			worst = s;
		}
	}
	return worst;
}

/** Sort key: errors first, then warnings, then info. */
export function severityRank(severity: Severity | undefined): number {
	return severity === undefined ? 3 : RANK[severity];
}

/** "2 console.log, 1 debugger, 1 new TODO": most frequent first, then in order of appearance. */
export function countLabels(labels: readonly string[]): string {
	const counts = new Map<string, number>();
	for (const label of labels) {
		counts.set(label, (counts.get(label) ?? 0) + 1);
	}
	return [...counts]
		.sort((a, b) => b[1] - a[1])
		.map(([label, n]) => `${n} ${label}`)
		.join(', ');
}

/** Hover text for a file: "api.ts — 3 leftovers: 1 console.log, 1 debugger, 1 new TODO". */
export function fileSummary(fileName: string, labels: readonly string[]): string {
	return `${fileName} — ${plural(labels.length, 'leftover')}: ${countLabels(labels)}`;
}

/** View title and status bar wording: "4 in 2 files". */
export function totalSummary(leftovers: number, files: number): string {
	return `${leftovers} in ${plural(files, 'file')}`;
}

/** "1 error, 3 warnings" for the severities present, most severe first. */
export function severityCounts(severities: readonly Severity[]): string {
	const words: Record<Severity, [string, string]> = {
		error: ['error', 'errors'],
		warning: ['warning', 'warnings'],
		info: ['info', 'info'],
	};
	return (['error', 'warning', 'info'] as const)
		.map((s) => [s, severities.filter((x) => x === s).length] as const)
		.filter(([, n]) => n > 0)
		.map(([s, n]) => plural(n, ...words[s]))
		.join(', ');
}
