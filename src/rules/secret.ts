import type { LineView, Rule, RuleMatch } from '../model';

interface TokenPattern {
	regex: RegExp;
	name: string;
}

/** Credentials with a recognizable shape. */
const TOKENS: readonly TokenPattern[] = [
	{ regex: /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY(?: BLOCK)?-----/g, name: 'private key' },
	{ regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, name: 'AWS access key ID' },
	{ regex: /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{22,255})\b/g, name: 'GitHub token' },
	{ regex: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g, name: 'Slack token' },
	{ regex: /\b[rs]k_live_[A-Za-z0-9]{20,}\b/g, name: 'Stripe live key' },
	{ regex: /\bAIza[0-9A-Za-z_-]{35}\b/g, name: 'Google API key' },
	{ regex: /\bsk-ant-[A-Za-z0-9_-]{20,}/g, name: 'Anthropic API key' },
	{ regex: /\bsk-(?:proj-)?[A-Za-z0-9]{20,}[A-Za-z0-9_-]*/g, name: 'OpenAI API key' },
];

/** Names that hold a secret: they end in api_key, secret, token, password and so on. */
const SECRET_NAME = String.raw`[A-Za-z0-9_.-]*?(?:api[_-]?key|secret[_-]?key|access[_-]?key|private[_-]?key|secret|token|passw(?:or)?d|pwd|credentials?)`;

/** `api_key = "…"`, `"password": "…"`, `token: '…'`: the value must be quoted in code. */
const QUOTED_ASSIGNMENT = new RegExp(String.raw`(?<![\w])(["']?)(${SECRET_NAME})\1\s*(?::=|=>|[:=])\s*(["'\x60])([^"'\x60\n]{8,})\3`, 'gi');

/** In config files (`.env`, YAML, INI...) values are often unquoted: `API_KEY=abc123…`. */
const BARE_ASSIGNMENT = new RegExp(String.raw`^\s*(?:export\s+)?(["']?)(${SECRET_NAME})\1\s*[:=]\s*["']?([^\s"'#]{8,})`, 'gi');
const CONFIG_LANGUAGES = new Set(['dotenv', 'properties', 'ini', 'yaml', 'toml', 'shellscript']);

/** Values that are clearly not real secrets. */
const PLACEHOLDER = /^(?:x+|\*+|\.+|<[^>]*>|\$\{[^}]*\}|\$\(.*\)|\{\{.*\}\}|%[^%]*%|\$[A-Z_][A-Z0-9_]*|(?:your|my|some|the)[-_ ].*|changeme|change[-_]?me|example.*|dummy.*|fake.*|test.*|sample.*|placeholder.*|redacted|secret|password|token|null|none|undefined|todo.*|enter[-_ ].*|replace[-_ ].*|process\.env\..*|os\.environ.*|env\(.*)$/i;

function looksReal(value: string): boolean {
	return !PLACEHOLDER.test(value) && !/\s/.test(value) && new Set(value).size >= 4;
}

/** Credentials: AWS keys, GitHub tokens, private key headers, `api_key = "…"` assignments... */
export const secret: Rule = {
	id: 'secret',
	languages: '*',
	defaultSeverity: 'error',
	check(line: LineView): RuleMatch[] {
		const matches: RuleMatch[] = [];
		const add = (start: number, end: number, name: string) => {
			if (!matches.some((m) => start < m.end && m.start < end)) {
				matches.push({ start, end, message: `Possible secret: ${name}`, label: 'secret' });
			}
		};
		for (const { regex, name } of TOKENS) {
			for (const m of line.text.matchAll(regex)) {
				add(m.index, m.index + m[0].length, name);
			}
		}
		for (const m of line.text.matchAll(QUOTED_ASSIGNMENT)) {
			if (looksReal(m[4])) {
				const valueStart = m.index + m[0].length - m[4].length - 1;
				add(valueStart, valueStart + m[4].length, `hard-coded ${m[2]}`);
			}
		}
		if (CONFIG_LANGUAGES.has(line.languageId)) {
			for (const m of line.text.matchAll(BARE_ASSIGNMENT)) {
				if (looksReal(m[3])) {
					const valueStart = m.index + m[0].length - m[3].length;
					add(valueStart, valueStart + m[3].length, `${m[2]} value`);
				}
			}
		}
		return matches.sort((a, b) => a.start - b.start);
	},
};
