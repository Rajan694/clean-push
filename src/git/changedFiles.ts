// Lists the files a scope covers and the lines each one added, by running git.
// Uses Node's child_process but no VS Code imports, so tests can run it on real repositories.
import { execFile } from 'child_process';
import type { AddedLines } from '../model';
import { addedRanges, mapThroughHunks, parseUnifiedDiff } from './addedLines';

export type Scope = 'unpushed' | 'uncommitted' | 'staged';

/** Runs git in one repository and resolves with its stdout. */
export type Git = (args: readonly string[]) => Promise<string>;

export interface ChangedFile {
	/** Path relative to the repository root, with `/` separators. */
	relativePath: string;
	addedLines: AddedLines;
}

export interface ChangeSet {
	files: ChangedFile[];
	/** The scope actually used: `unpushed` becomes `uncommitted` when the branch has no upstream. */
	scope: Scope;
}

export function gitRunner(gitPath: string, cwd: string): Git {
	return (args) =>
		new Promise((resolve, reject) => {
			execFile(
				gitPath,
				['-c', 'core.quotepath=false', ...args],
				{
					cwd,
					maxBuffer: 256 * 1024 * 1024,
					windowsHide: true,
					// Read-only commands shouldn't take the index lock the Git extension also uses.
					env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
				},
				(error, stdout, stderr) => {
					if (error) {
						reject(new Error(`git ${args.join(' ')} failed: ${stderr.trim() || error.message}`));
					} else {
						resolve(stdout);
					}
				},
			);
		});
}

/** `git diff` flags that give the same output whatever the user's git config says. */
function diffArgs(...extra: string[]): string[] {
	return [
		'diff', '-U0', '--no-color', '--no-ext-diff', '--no-textconv', '-M',
		'--src-prefix=a/', '--dst-prefix=b/', '--ignore-submodules=all',
		...extra, '--',
	];
}

async function hasHead(git: Git): Promise<boolean> {
	try {
		await git(['rev-parse', '--verify', '--quiet', 'HEAD']);
		return true;
	} catch {
		return false;
	}
}

async function lsFiles(git: Git, ...flags: string[]): Promise<string[]> {
	const out = await git(['ls-files', '-z', ...flags]);
	return out.split('\0').filter(Boolean);
}

/**
 * The files the scope covers and their added lines:
 * - `unpushed`: diff from `git merge-base HEAD @{upstream}` to the working tree, plus untracked files
 * - `uncommitted`: diff from HEAD to the working tree, plus untracked files
 * - `staged`: diff from HEAD to the index, mapped to working-tree line numbers
 */
export async function listChangedFiles(git: Git, scope: Scope): Promise<ChangeSet> {
	const headExists = await hasHead(git);

	if (scope === 'staged') {
		const [staged, unstaged] = await Promise.all([
			git(diffArgs('--cached')).then(parseUnifiedDiff),
			git(diffArgs()).then(parseUnifiedDiff),
		]);
		const files: ChangedFile[] = [];
		for (const [relativePath, hunks] of staged) {
			const lines = mapThroughHunks(addedRanges(hunks), unstaged.get(relativePath) ?? []);
			if (lines.length > 0) {
				files.push({ relativePath, addedLines: lines });
			}
		}
		return { files, scope };
	}

	const untracked = await lsFiles(git, '--others', '--exclude-standard');

	if (!headExists) {
		// No commits yet: every tracked and untracked file is new.
		const tracked = await lsFiles(git);
		const all = [...new Set([...tracked, ...untracked])];
		return { files: all.map((relativePath) => ({ relativePath, addedLines: 'all' })), scope };
	}

	let base = 'HEAD';
	let used: Scope = 'uncommitted';
	if (scope === 'unpushed') {
		try {
			base = (await git(['merge-base', 'HEAD', '@{upstream}'])).trim();
			used = 'unpushed';
		} catch {
			// No upstream branch: fall back to uncommitted changes.
		}
	}

	const files: ChangedFile[] = [];
	for (const [relativePath, hunks] of parseUnifiedDiff(await git(diffArgs(base)))) {
		const lines = addedRanges(hunks);
		if (lines.length > 0) {
			files.push({ relativePath, addedLines: lines });
		}
	}
	for (const relativePath of untracked) {
		files.push({ relativePath, addedLines: 'all' });
	}
	return { files, scope: used };
}
