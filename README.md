# Clean Push

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

**Catch debug leftovers before you push.** Clean Push checks only the lines you changed for `console.log`, `debugger`, `.only` in tests, new TODOs, secrets and merge-conflict markers, and lists them in a **Leftovers** section right under Git's Changes list in Source Control.

> **Status: early development.** Milestones 0.1 and 0.2 work: leftovers in the lines you changed show up as warnings in the editor and the Problems panel, in a Leftovers section under Git's Changes list, and in the status bar. Quick fixes and the other rules arrive by milestone (see [Roadmap](#roadmap)). The full design is in [docs/DESIGN.md](docs/DESIGN.md).

## Features

- **Only your changes.** Checks the lines you added (unpushed commits, staged and unstaged changes), so old code written by others doesn't nag you.
- **Leftovers in Source Control.** A section under Git's Changes list with a count per file, a hover summary, and one click to jump to each leftover.
- **In the editor.** Squiggles, Problems panel entries, scrollbar marks, and F8 / Shift+F8 to step through leftovers.
- **Quick fixes.** Remove a `console.log` or `.only`, fix every leftover in a file, or ignore a line with `// leftover-ignore`.
- **Optional pre-push hook.** A plain `sh` git hook that blocks pushes containing conflict markers, focused tests, `debugger` or private keys.
- **Local only.** No network calls, no AI.

## Rules

| Rule | Catches | Default |
| --- | --- | --- |
| `conflict-marker` | `<<<<<<<`, `=======`, `>>>>>>>` | Error |
| `secret` | AWS keys, GitHub tokens, private key headers, `api_key = "…"` | Error |
| `env-file` | A changed `.env` file that git doesn't ignore | Error |
| `focused-test` | `.only(`, `fit(`, `fdescribe(` | Error |
| `debugger` | `debugger;`, `breakpoint()`, `pdb.set_trace()`, `binding.pry` | Warning |
| `console` | `console.log` / `.debug` / `.info` / `.trace` (not `console.warn` / `console.error` by default) | Warning |
| `print` | `print(`, `System.out.println`, `fmt.Println`, `dbg!`, `var_dump`, `dd(` | Warning |
| `large-file` | An added file over 1 MB | Warning |
| `todo` | New `TODO`, `FIXME`, `HACK`, `XXX` | Info |

## Extension Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `cleanPush.scope` | `unpushed` | `unpushed`, `uncommitted` or `staged` |
| `cleanPush.rules` | see table above | Per rule: `error`, `warning`, `info` or `off` |
| `cleanPush.ignoreList` | `console.warn`, `console.error` | Calls or text that never count; `/…/` for a regex |
| `cleanPush.customRules` | `[]` | Extra regex rules |
| `cleanPush.exclude` | `dist`, `vendor`, `*.min.js`, lockfiles | Files never checked |
| `cleanPush.largeFileKB` | `1024` | Size limit for the `large-file` rule |
| `cleanPush.ignoreComment` | `leftover-ignore` | Marker that skips a line |
| `cleanPush.decorateExplorer` | `true` | Color and count badge in the Explorer and tabs |

## Roadmap

| Version | Adds |
| --- | --- |
| 0.1 ✓ | Warnings in the editor: added-line detection, `console`, `debugger`, `focused-test`, `conflict-marker`, `todo` (also the `scope`, `ignoreList`, `exclude`, `largeFileKB` and `ignoreComment` settings) |
| 0.2 ✓ | Leftovers section in Source Control, status bar item |
| 0.3 | Quick fixes, Fix all, Explorer and tab badges, `leftover-ignore` |
| 0.4 | `secret`, `env-file`, `large-file`, `print`, custom rules, scope setting |
| 1.0 | Optional pre-push git hook, cross-platform tests, Marketplace listing |

## Requirements

- Git, and VS Code's built-in Git extension (enabled by default).

## Installation

Install from the VS Code Marketplace or Open VSX once published, or from a `.vsix` file attached to a [GitHub release](https://github.com/Rajan694/clean-push/releases): see [INSTALL_FROM_VSIX.md](INSTALL_FROM_VSIX.md).

## Development

Requires Node.js 22 or later.

```bash
npm install
npm run compile     # type-check, lint, bundle to dist/
npm test            # extension tests in a downloaded VS Code
```

The rule engine (`src/scanner.ts`, `src/lexer.ts`, `src/rules/`, `src/summary.ts`, `src/git/addedLines.ts`, `src/git/changedFiles.ts`) has no VS Code imports, so its tests also run in plain mocha, in well under a second:

```bash
npm run compile-tests && npx mocha --ui tdd out/test/rules.test.js out/test/addedLines.test.js out/test/changedFiles.test.js out/test/summary.test.js
```

Press `F5` in VS Code to open a window with the extension loaded. Packaging and publishing are described in [RELEASING.md](RELEASING.md).

## License

[MIT](LICENSE)
