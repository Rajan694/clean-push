// The optional pre-push git hook: its script, and finding, writing and removing it.
// Uses Node's fs but no VS Code imports, so tests can run it on real repositories.
import * as fs from 'fs';
import * as path from 'path';
import type { Git } from '../git/changedFiles';

/** First comment line of our hook; how we recognize a hook we wrote. */
export const HOOK_MARKER = '# clean-push v1';

/**
 * The checks, as POSIX sh. Only error-level leftovers that are easy to spot in a diff block
 * a push: conflict markers, focused tests, a bare `debugger`, private keys and AWS keys.
 */
const CHECK = String.raw`is_zero() { case "$1" in *[!0]*) return 1 ;; *) return 0 ;; esac; }
tab=$(printf '\t')
pattern="$tab(<<<<<<<|>>>>>>>)( |\$)|$tab[[:space:]]*debugger;?[[:space:]]*\$|(describe|context|suite|it|test|specify)\\.only\\(|-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16}"
status=0
while read -r local_ref local_sha remote_ref remote_sha; do
  is_zero "$local_sha" && continue  # deleting a branch
  if is_zero "$remote_sha" || ! git cat-file -e "$remote_sha^{commit}" 2>/dev/null; then
    range="$local_sha --not --remotes"  # new branch, or the remote's commit isn't fetched
  else
    range="$remote_sha..$local_sha"
  fi
  # Added lines as "path<TAB>text", then the leftovers among them.
  hits=$(git log -p --no-color --no-ext-diff --src-prefix=a/ --dst-prefix=b/ --format= $range -- |
    awk '/^\+\+\+ / { file = substr($0, 7); next } /^\+/ { print file "\t" substr($0, 2) }' |
    grep -E "$pattern")
  if [ -n "$hits" ]; then
    echo "clean-push: leftovers in the commits for $remote_ref:" >&2
    echo "$hits" | head -n 20 | sed "s/$tab/: /" >&2
    status=1
  fi
done
if [ "$status" -ne 0 ]; then
  echo "Fix them, or push anyway with: git push --no-verify" >&2
fi`;

/** The whole hook file. */
export function hookScript(): string {
	return [
		'#!/bin/sh',
		`${HOOK_MARKER} (installed by the Clean Push VS Code extension)`,
		'# Blocks a push whose new commits add merge-conflict markers, focused tests (.only),',
		'# a bare `debugger`, a private key or an AWS access key.',
		'# Push anyway with: git push --no-verify',
		'# Remove it with the command "Clean Push: Uninstall Git Pre-push Hook".',
		'',
		CHECK,
		'exit $status',
		'',
	].join('\n');
}

/**
 * Lines to add to a pre-push hook managed by something else (Husky, lefthook...). They read
 * the refs git passes on stdin, so they must come before anything else that reads stdin.
 */
export function hookSnippet(): string {
	return [
		`${HOOK_MARKER}: block pushes that add conflict markers, .only, debugger or private keys.`,
		'# git passes the pushed refs on stdin once: put this before anything else that reads it.',
		'(',
		CHECK,
		'exit $status',
		') || exit 1',
		'',
	].join('\n');
}

export type HookState =
	/** core.hooksPath is set: another tool manages hooks; we don't write there. */
	| { kind: 'hooksPath'; hooksPath: string }
	/** A pre-push hook exists and isn't ours. */
	| { kind: 'foreign'; file: string }
	| { kind: 'ours'; file: string }
	| { kind: 'none'; file: string };

/** Where the repository's pre-push hook lives and who owns it. */
export async function hookState(git: Git, root: string): Promise<HookState> {
	const hooksPath = (await git(['config', '--get', 'core.hooksPath']).catch(() => '')).trim();
	if (hooksPath) {
		return { kind: 'hooksPath', hooksPath };
	}
	// --git-path handles worktrees and submodules, where .git is a file.
	const hooksDir = path.resolve(root, (await git(['rev-parse', '--git-path', 'hooks'])).trim());
	const file = path.join(hooksDir, 'pre-push');
	let text: string;
	try {
		text = await fs.promises.readFile(file, 'utf8');
	} catch {
		return { kind: 'none', file };
	}
	return text.split('\n', 3).some((line) => line.startsWith(HOOK_MARKER)) ? { kind: 'ours', file } : { kind: 'foreign', file };
}

/** Writes (or updates) our hook file, executable. */
export async function writeHook(file: string): Promise<void> {
	await fs.promises.mkdir(path.dirname(file), { recursive: true });
	await fs.promises.writeFile(file, hookScript(), { mode: 0o755 });
	await fs.promises.chmod(file, 0o755);
}
