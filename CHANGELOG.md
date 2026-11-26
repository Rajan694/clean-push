# Change Log

All notable changes to the "Clean Push" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/).
Write new entries under **[Unreleased]**. The publish script moves them under the new version number when you release.

## [Unreleased]

## [1.0.0] - 2026-11-26

### Added

- Checks the lines you added for leftovers after every save and every Git change (commit, stage, checkout, pull), and shows them as squiggles, scrollbar marks and Problems panel entries (source `clean-push`); F8 steps through them.
- Rules: `console` (console.log, .debug, .info, .trace, .dir, .table; .warn and .error are in the ignore list by default), `debugger` (JavaScript, Python, Ruby), `focused-test` (`.only(`, `fit(`, `fdescribe(` in test files), `conflict-marker` and `todo` (new TODO / FIXME / HACK / XXX comments). Comments and strings are skipped where that makes sense.
- Settings: `cleanPush.scope` (`unpushed` falls back to `uncommitted` when the branch has no upstream), `cleanPush.rules`, `cleanPush.ignoreList`, `cleanPush.exclude`, `cleanPush.largeFileKB` and `cleanPush.ignoreComment` (`// leftover-ignore`).
- Commands: **Clean Push: Refresh** and **Clean Push: Change Scope**.
- **Leftovers** section in Source Control, under Git's Changes list: one row per file with its count and folder, colored by its most severe leftover, a hover summary (*"api.ts — 3 leftovers: 1 console.log, 1 debugger, 1 new TODO"*) and a **Go to First Leftover** button. Each leftover row shows the line with the leftover highlighted; clicking it opens the file at that line. The title shows the total, and the section hides itself when there are no leftovers.
- Status bar item (*"⚠ 4 leftovers"*) that opens the Leftovers section.
- Quick fixes (lightbulb): **Remove console.log** / **Remove debugger** / **Remove .only** / **Change fit to it**, **Ignore this line** (adds `// leftover-ignore` in the file's comment syntax) and **Remove all leftovers in this file**. A removal is offered only when the leftover is a whole statement, so `const x = console.log(y)` or `if (a) console.log(x)` are never broken; multi-line calls are removed whole, and a Python block that would be left empty gets `pass`.
- **Fix All Leftovers in File** button on Leftovers rows that have something to fix. It saves the file afterwards if it had no unsaved changes.
- Gutter icon and a faint line background on lines with leftovers (colors `cleanPush.errorLineBackground` and `cleanPush.warningLineBackground` can be themed).
- Files with leftovers are colored in the Explorer and editor tabs, with a count badge (`cleanPush.decorateExplorer`).
- Rule `secret` (error): AWS access keys, GitHub, Slack, Stripe live, Google, OpenAI and Anthropic tokens, private key headers, and hard-coded values for names such as `apiKey`, `password` or `client_secret` (quoted in code, also unquoted in `.env`, YAML, INI, TOML and shell files). Placeholders such as `"your-key-here"`, `"${VAR}"` or `"xxxx"` are not flagged.
- Rule `print` (warning): `print(` / `pprint(` in Python, `System.out.println` / `printf`, `fmt.Println` and Go's `println`, Rust's `dbg!`, PHP's `var_dump`, `print_r` and `dd(`; removable with the same quick fix as `console`.
- Rule `env-file` (error): a changed `.env` file that git doesn't ignore (`.env.example`, `.env.sample` and similar are fine).
- Rule `large-file` (warning): an added file bigger than `cleanPush.largeFileKB`, binary files included.
- **Add to .gitignore** quick fix and Leftovers-row menu item for `env-file` and `large-file`; if git already tracks the file it offers to stop tracking it (`git rm --cached`).
- `cleanPush.customRules`: your own regex rules, with languages, severity and message.
- **Clean Push: Install Git Pre-push Hook** / **Uninstall Git Pre-push Hook**: an optional POSIX `sh` hook that blocks a push whose new commits add conflict markers, `.only(`, a bare `debugger`, a private key or an AWS access key, naming the file and line. It never overwrites another hook; with `core.hooksPath` set (Husky, lefthook) it shows the lines to add to your own hook instead.

## [0.1.0] - 2026-11-25

- Project setup: TypeScript + esbuild build, tests, packaging and release scripts.
