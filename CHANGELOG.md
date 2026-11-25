# Change Log

All notable changes to the "Clean Push" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/).
Write new entries under **[Unreleased]**. The publish script moves them under the new version number when you release.

## [Unreleased]

### Added

- Checks the lines you added for leftovers after every save and every Git change (commit, stage, checkout, pull), and shows them as squiggles, scrollbar marks and Problems panel entries (source `clean-push`); F8 steps through them.
- Rules: `console` (console.log, .debug, .info, .trace, .dir, .table; .warn and .error are in the ignore list by default), `debugger` (JavaScript, Python, Ruby), `focused-test` (`.only(`, `fit(`, `fdescribe(` in test files), `conflict-marker` and `todo` (new TODO / FIXME / HACK / XXX comments). Comments and strings are skipped where that makes sense.
- Settings: `cleanPush.scope` (`unpushed` falls back to `uncommitted` when the branch has no upstream), `cleanPush.rules`, `cleanPush.ignoreList`, `cleanPush.exclude`, `cleanPush.largeFileKB` and `cleanPush.ignoreComment` (`// leftover-ignore`).
- Commands: **Clean Push: Refresh** and **Clean Push: Change Scope**.
- **Leftovers** section in Source Control, under Git's Changes list: one row per file with its count and folder, colored by its most severe leftover, a hover summary (*"api.ts — 3 leftovers: 1 console.log, 1 debugger, 1 new TODO"*) and a **Go to First Leftover** button. Each leftover row shows the line with the leftover highlighted; clicking it opens the file at that line. The title shows the total, and the section hides itself when there are no leftovers.
- Status bar item (*"⚠ 4 leftovers"*) that opens the Leftovers section.

## [0.1.0] - 2026-11-25

- Project setup: TypeScript + esbuild build, tests, packaging and release scripts.
