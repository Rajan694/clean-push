import * as assert from 'assert';
import { countLabels, fileSummary, plural, severityCounts, severityRank, totalSummary, worstSeverity } from '../summary';

suite('summary', () => {
	test('plural', () => {
		assert.strictEqual(plural(1, 'leftover'), '1 leftover');
		assert.strictEqual(plural(0, 'file'), '0 files');
		assert.strictEqual(plural(2, 'info', 'info'), '2 info');
	});

	test('file hover text counts labels, most frequent first', () => {
		assert.strictEqual(countLabels(['debugger', 'console.log', 'new TODO', 'console.log']), '2 console.log, 1 debugger, 1 new TODO');
		assert.strictEqual(
			fileSummary('api.ts', ['console.log', 'debugger', 'new TODO']),
			'api.ts — 3 leftovers: 1 console.log, 1 debugger, 1 new TODO',
		);
	});

	test('totals and severities', () => {
		assert.strictEqual(totalSummary(4, 2), '4 in 2 files');
		assert.strictEqual(totalSummary(1, 1), '1 in 1 file');
		assert.strictEqual(severityCounts(['warning', 'error', 'warning', 'info']), '1 error, 2 warnings, 1 info');
		assert.strictEqual(worstSeverity(['info', 'warning', 'info']), 'warning');
		assert.strictEqual(worstSeverity([]), undefined);
		assert.ok(severityRank('error') < severityRank('warning') && severityRank('info') < severityRank(undefined));
	});
});
