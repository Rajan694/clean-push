# Clean Push

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

**Catch debug leftovers before you push.** Clean Push checks only the lines you changed for `console.log`, `debugger`, `.only` in tests, new TODOs, secrets and merge-conflict markers, and lists them in a **Leftovers** section right under Git's Changes list in Source Control.

![The Leftovers section in Source Control, next to an editor with highlighted leftovers](docs/images/leftovers-in-source-control.png)

## Features

- **Only your changes.** Checks the lines you added (unpushed commits, staged and unstaged changes), so old code written by others doesn't nag you. Comments and strings are skipped where that makes sense: a `"console.log"` in a string or a commented-out call isn't a leftover.
- **Leftovers in Source Control.** A section under Git's Changes list, one row per file with its count and a hover summary (*"api.ts — 3 leftovers: 1 console.log, 1 debugger, 1 new TODO"*). Click a leftover to open the file at that line; **Go to First Leftover** and **Fix All Leftovers in File** sit on each file row. The section hides itself when there's nothing to show.
- **In the editor.** Squiggles with hover messages, a gutter icon and faint line highlight, marks on the scrollbar, Problems panel entries (source `clean-push`), and F8 / Shift+F8 to step through leftovers.
- **Quick fixes.** Remove a `console.log`, `print`, `debugger` or `.only` from the lightbulb; ignore a line with `// leftover-ignore`; add a `.env` or large file to `.gitignore`. Removals are only offered when they can't break the code (never in `const x = console.log(y)` or `if (a) console.log(x)`).
- **Explorer, tabs and status bar.** Files with leftovers are colored with a count badge, and a status bar item (*"⚠ 4 leftovers"*) opens the Leftovers section.
- **Optional pre-push hook.** A plain `sh` git hook that blocks pushes containing conflict markers, focused tests, `debugger` or private keys, installed only when you ask.
- **Local only.** No network calls, no AI.

Checks run when you save a file and whenever Git's state changes (commit, stage, checkout, pull).

## See it in action

### Remove a leftover with a quick fix

Put the cursor on a leftover and press `Ctrl+.` (`Cmd+.` on macOS). The count in the Leftovers section and the status bar drops as soon as you save.

![Removing a console.log with the quick fix](docs/images/quick-fix.gif)

### Fix all leftovers in a file

**Fix All Leftovers in File** (the wand on a file row) removes every leftover that can be removed safely. Secrets and TODOs stay for you to handle.

![Fix All Leftovers in File removes console.log and debugger lines in one click](docs/images/fix-all-in-file.gif)

### Hover for details

![Hovering a leftover shows the rule and a Quick Fix link](docs/images/editor-hover.png)

### Explorer, tabs, Problems and status bar

![Files with leftovers are colored in the Explorer and tabs, listed in Problems, and counted in the status bar](docs/images/explorer-and-problems.png)

### Block risky pushes with the pre-push hook

![Installing the pre-push hook, then a git push blocked by a debugger statement and an it.only](docs/images/pre-push-hook.gif)

## Rules

| Rule | Catches | Default |
| --- | --- | --- |
| `conflict-marker` | Lines starting with `<<<<<<<`, `=======`, `>>>>>>>` | Error |
| `secret` | AWS keys, GitHub / Slack / Stripe / Google / OpenAI / Anthropic tokens, private key headers, `api_key = "…"` (placeholders like `"your-key-here"` don't count) | Error |
| `env-file` | A changed `.env` file that git doesn't ignore (`.env.example` is fine) | Error |
| `focused-test` | `.only(`, `fit(`, `fdescribe(` in JavaScript / TypeScript test files | Error |
| `debugger` | `debugger;`, `breakpoint()`, `pdb.set_trace()`, `import pdb`, `binding.pry`, `byebug` | Warning |
| `console` | `console.log` / `.debug` / `.info` / `.trace` / `.dir` / `.table` (`console.warn` and `console.error` are in the ignore list by default) | Warning |
| `print` | `print(` in Python, `System.out.println`, `fmt.Println`, `dbg!`, `var_dump`, `print_r`, `dd(` | Warning |
| `large-file` | An added file bigger than `cleanPush.largeFileKB` (1 MB) | Warning |
| `todo` | New `TODO`, `FIXME`, `HACK`, `XXX` comments | Info |

Skip a single line by ending it with `leftover-ignore` (in a comment):

```js
console.log(response); // leftover-ignore
```

## Pre-push hook

VS Code doesn't let extensions stop its own Push button, so for a hard stop run **Clean Push: Install Git Pre-push Hook**. It writes `.git/hooks/pre-push`, a POSIX `sh` script that works on Linux, macOS and Windows (through the `sh` that comes with Git for Windows).

- It blocks a push only for error-level leftovers that are easy to spot in a diff: conflict markers, `.only(`, a bare `debugger`, private keys and AWS access keys. Warnings like `console.log` never block.
- It checks only the commits being pushed (for a new branch, the ones no remote has yet).
- `git push --no-verify` skips it, as with any git hook.
- It never overwrites a hook Clean Push didn't write. If `core.hooksPath` is set (Husky, lefthook and similar), nothing is written: Clean Push opens the lines to add to your own pre-push hook instead.
- **Clean Push: Uninstall Git Pre-push Hook** removes it, and only it.

## Extension Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `cleanPush.scope` | `unpushed` | Which added lines are checked: `unpushed` (commits not pushed yet plus staged and unstaged changes; uncommitted changes when the branch has no upstream), `uncommitted` or `staged`. Also in the Leftovers title bar. |
| `cleanPush.rules` | see table above | Per rule: `error`, `warning`, `info` or `off` |
| `cleanPush.ignoreList` | `console.warn`, `console.error` | Calls or text that never count as leftovers, e.g. `logger.debug`, or a regex written as `/…/` |
| `cleanPush.customRules` | `[]` | Your own regex rules (see below) |
| `cleanPush.exclude` | `dist`, `vendor`, `*.min.js`, lockfiles | Glob patterns of files that are never checked |
| `cleanPush.largeFileKB` | `1024` | Size for the `large-file` rule; bigger files aren't scanned line by line |
| `cleanPush.ignoreComment` | `leftover-ignore` | Marker that skips a line |
| `cleanPush.decorateExplorer` | `true` | Color and count badge in the Explorer and editor tabs |

Custom rules match a regex against each added line:

```json
"cleanPush.customRules": [
  {
    "id": "no-localhost-url",
    "pattern": "https?://localhost:\\d+",
    "languages": ["typescript", "javascript"],
    "severity": "warning",
    "message": "Hard-coded localhost URL"
  }
]
```

The line background colors can be themed with `cleanPush.errorLineBackground` and `cleanPush.warningLineBackground` in `workbench.colorCustomizations`.

## Commands

| Command | What it does |
| --- | --- |
| Clean Push: Refresh | Checks every repository again |
| Clean Push: Change Scope | Picks `cleanPush.scope` |
| Clean Push: Install Git Pre-push Hook | Writes the optional pre-push hook |
| Clean Push: Uninstall Git Pre-push Hook | Removes it |

## Requirements

- Git, and VS Code's built-in Git extension (enabled by default).

## Installation

Install from the VS Code Marketplace or Open VSX.

To install a specific version, download its `.vsix` file from the [GitHub releases](https://github.com/Rajan694/clean-push/releases), then in VS Code open the Extensions view, click `...` and choose **Install from VSIX...**, or run:

```bash
code --install-extension clean-push-X.Y.Z.vsix
```

## License

[MIT](LICENSE)
