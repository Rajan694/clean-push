// Language ids for files that are not open in an editor, and each language's comment and
// string syntax for the lexer. No VS Code imports.

const BY_EXTENSION: Record<string, string> = {
	js: 'javascript', mjs: 'javascript', cjs: 'javascript',
	jsx: 'javascriptreact',
	ts: 'typescript', mts: 'typescript', cts: 'typescript',
	tsx: 'typescriptreact',
	vue: 'vue', svelte: 'svelte',
	py: 'python', pyw: 'python', pyi: 'python',
	rb: 'ruby', rake: 'ruby', gemspec: 'ruby',
	java: 'java', go: 'go', rs: 'rust', php: 'php',
	c: 'c', h: 'c',
	cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp', hxx: 'cpp',
	cs: 'csharp', swift: 'swift', kt: 'kotlin', kts: 'kotlin', scala: 'scala', dart: 'dart',
	groovy: 'groovy', gradle: 'groovy', m: 'objective-c', mm: 'objective-cpp', fs: 'fsharp',
	css: 'css', scss: 'scss', less: 'less',
	html: 'html', htm: 'html', xml: 'xml', svg: 'xml', xaml: 'xml', csproj: 'xml',
	md: 'markdown', markdown: 'markdown', mdx: 'markdown',
	json: 'json', jsonc: 'jsonc', json5: 'jsonc',
	yaml: 'yaml', yml: 'yaml', toml: 'toml', ini: 'ini', cfg: 'ini', properties: 'properties',
	sh: 'shellscript', bash: 'shellscript', zsh: 'shellscript',
	ps1: 'powershell', psm1: 'powershell', bat: 'bat', cmd: 'bat',
	sql: 'sql', lua: 'lua', hs: 'haskell', elm: 'elm',
	clj: 'clojure', cljs: 'clojure', edn: 'clojure', lisp: 'lisp', el: 'lisp', scm: 'scheme',
	tex: 'latex', erl: 'erlang', ex: 'elixir', exs: 'elixir', pl: 'perl', pm: 'perl', r: 'r',
	jl: 'julia', vb: 'vb', tf: 'terraform', graphql: 'graphql', gql: 'graphql', proto: 'proto3',
	txt: 'plaintext',
};

const BY_NAME: Record<string, string> = {
	dockerfile: 'dockerfile',
	makefile: 'makefile',
	gemfile: 'ruby',
	rakefile: 'ruby',
};

/** VS Code language id for a path, guessed from its name; 'unknown' if not known. */
export function languageFromPath(path: string): string {
	const base = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
	if (base in BY_NAME) {
		return BY_NAME[base];
	}
	if (base.startsWith('.env')) {
		return 'dotenv';
	}
	const dot = base.lastIndexOf('.');
	if (dot <= 0) {
		return 'unknown';
	}
	return BY_EXTENSION[base.slice(dot + 1)] ?? 'unknown';
}

export interface StringSyntax {
	open: string;
	close: string;
	/** Whether the string can continue on the next line. */
	multiline: boolean;
	/** Whether a backslash escapes the next character. */
	escapes: boolean;
}

export interface Syntax {
	line: readonly string[];
	block: readonly (readonly [string, string])[];
	strings: readonly StringSyntax[];
}

const dq: StringSyntax = { open: '"', close: '"', multiline: false, escapes: true };
const sq: StringSyntax = { open: "'", close: "'", multiline: false, escapes: true };
const backtick: StringSyntax = { open: '`', close: '`', multiline: true, escapes: true };
const rawBacktick: StringSyntax = { open: '`', close: '`', multiline: true, escapes: false };
const tripleDq: StringSyntax = { open: '"""', close: '"""', multiline: true, escapes: true };
const tripleSq: StringSyntax = { open: "'''", close: "'''", multiline: true, escapes: true };

const C_BLOCK = ['/*', '*/'] as const;
const HTML_BLOCK = ['<!--', '-->'] as const;

const JS: Syntax = { line: ['//'], block: [C_BLOCK], strings: [dq, sq, backtick] };
const C_LIKE: Syntax = { line: ['//'], block: [C_BLOCK], strings: [dq, sq] };
const TRIPLE_C_LIKE: Syntax = { line: ['//'], block: [C_BLOCK], strings: [tripleDq, dq, sq] };
const HASH: Syntax = { line: ['#'], block: [], strings: [dq, sq] };

const SYNTAX: Record<string, Syntax> = {
	javascript: JS, typescript: JS, javascriptreact: JS, typescriptreact: JS,
	vue: { line: ['//'], block: [C_BLOCK, HTML_BLOCK], strings: [dq, sq, backtick] },
	svelte: { line: ['//'], block: [C_BLOCK, HTML_BLOCK], strings: [dq, sq, backtick] },
	java: TRIPLE_C_LIKE, kotlin: TRIPLE_C_LIKE, scala: TRIPLE_C_LIKE, swift: TRIPLE_C_LIKE,
	c: C_LIKE, cpp: C_LIKE, csharp: C_LIKE, 'objective-c': C_LIKE, 'objective-cpp': C_LIKE,
	dart: TRIPLE_C_LIKE, groovy: TRIPLE_C_LIKE, fsharp: C_LIKE, jsonc: C_LIKE, proto3: C_LIKE,
	go: { line: ['//'], block: [C_BLOCK], strings: [dq, sq, rawBacktick] },
	// No single quotes: Rust uses them for lifetimes ('a) as well as chars.
	rust: { line: ['//'], block: [C_BLOCK], strings: [dq] },
	php: { line: ['//', '#'], block: [C_BLOCK], strings: [dq, sq] },
	css: { line: [], block: [C_BLOCK], strings: [dq, sq] },
	scss: C_LIKE, less: C_LIKE,
	json: { line: [], block: [], strings: [dq] },
	python: { line: ['#'], block: [], strings: [tripleDq, tripleSq, dq, sq] },
	ruby: HASH, perl: HASH, r: HASH, elixir: HASH, julia: HASH, powershell: HASH,
	shellscript: HASH, yaml: HASH, toml: HASH, dockerfile: HASH, makefile: HASH,
	properties: { line: ['#', '!'], block: [], strings: [] },
	ini: { line: [';', '#'], block: [], strings: [dq] },
	dotenv: { line: ['#'], block: [], strings: [dq, sq] },
	terraform: { line: ['#', '//'], block: [C_BLOCK], strings: [dq] },
	graphql: { line: ['#'], block: [], strings: [tripleDq, dq] },
	sql: { line: ['--'], block: [C_BLOCK], strings: [sq, dq] },
	lua: { line: ['--'], block: [['--[[', ']]']], strings: [dq, sq] },
	haskell: { line: ['--'], block: [['{-', '-}']], strings: [dq] },
	elm: { line: ['--'], block: [['{-', '-}']], strings: [dq] },
	clojure: { line: [';'], block: [], strings: [dq] },
	lisp: { line: [';'], block: [], strings: [dq] },
	scheme: { line: [';'], block: [], strings: [dq] },
	latex: { line: ['%'], block: [], strings: [] },
	erlang: { line: ['%'], block: [], strings: [dq] },
	vb: { line: ["'"], block: [], strings: [{ open: '"', close: '"', multiline: false, escapes: false }] },
	bat: { line: ['::', 'REM ', 'rem '], block: [], strings: [] },
	html: { line: [], block: [HTML_BLOCK], strings: [] },
	xml: { line: [], block: [HTML_BLOCK], strings: [] },
	markdown: { line: [], block: [HTML_BLOCK], strings: [] },
	plaintext: { line: [], block: [], strings: [] },
};

/** For languages not listed: the common comment forms, and no strings (prose has apostrophes). */
const FALLBACK: Syntax = { line: ['//', '#'], block: [C_BLOCK, HTML_BLOCK], strings: [] };

export function syntaxFor(languageId: string): Syntax {
	return SYNTAX[languageId] ?? FALLBACK;
}

/** JavaScript-family languages, used by the console and debugger rules. */
export const JS_LANGUAGES = ['javascript', 'typescript', 'javascriptreact', 'typescriptreact', 'vue', 'svelte'] as const;
