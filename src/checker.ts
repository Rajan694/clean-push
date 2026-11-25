import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { API, Repository } from './git/git';
import { gitRunner, listChangedFiles, type ChangedFile, type Scope } from './git/changedFiles';
import type { Finding, Leftover } from './model';
import { languageFromPath } from './languages';
import { scanFileInfo, scanText } from './scanner';
import { readSettings, SECTION, type Settings } from './config';
import type { LeftoverStore } from './store';

/** Files beyond this many in one repository are not read, to keep checks fast. */
const MAX_FILES = 2000;
/** Wait after a save or Git change before checking, so bursts of events cause one check. */
const DEBOUNCE_MS = 250;

interface CacheEntry {
	key: string;
	findings: Finding[];
}

interface RepoState {
	repo: Repository;
	root: string;
	timer?: ReturnType<typeof setTimeout>;
	running?: Promise<void>;
	/** Another check was asked for while one was running. */
	rerun: boolean;
	/** Bumped to cancel the running check. */
	generation: number;
	/** Results per absolute path, reused while the file and its added lines are unchanged. */
	cache: Map<string, CacheEntry>;
	lastScope?: Scope;
	subscription: vscode.Disposable;
}

/**
 * Decides when each repository is checked and runs the checks: after a save, after a Git
 * change (commit, stage, checkout, pull...), and when settings change. A new check cancels
 * the one still running; results go to the LeftoverStore.
 */
export class Checker implements vscode.Disposable {
	private readonly repos = new Map<string, RepoState>();
	private readonly disposables: vscode.Disposable[] = [];

	constructor(
		private readonly api: API,
		private readonly store: LeftoverStore,
		private readonly log: vscode.LogOutputChannel,
	) {
		this.disposables.push(
			api.onDidOpenRepository((repo) => this.addRepository(repo)),
			api.onDidCloseRepository((repo) => this.removeRepository(repo)),
			vscode.workspace.onDidSaveTextDocument((doc) => {
				const state = this.stateFor(doc.uri);
				if (state) {
					this.schedule(state);
				}
			}),
			vscode.workspace.onDidChangeConfiguration((e) => {
				if (e.affectsConfiguration(SECTION)) {
					this.refresh();
				}
			}),
		);
		for (const repo of api.repositories) {
			this.addRepository(repo);
		}
	}

	/** Checks every repository again, without reusing cached results. */
	refresh(): Promise<void> {
		const runs: Promise<void>[] = [];
		for (const state of this.repos.values()) {
			state.cache.clear();
			clearTimeout(state.timer);
			runs.push(this.run(state));
		}
		return Promise.all(runs).then(() => undefined);
	}

	private stateFor(uri: vscode.Uri): RepoState | undefined {
		if (uri.scheme !== 'file') {
			return undefined;
		}
		const repo = this.api.getRepository(uri);
		return repo ? this.repos.get(repo.rootUri.fsPath) : undefined;
	}

	private addRepository(repo: Repository): void {
		const root = repo.rootUri.fsPath;
		if (this.repos.has(root)) {
			return;
		}
		const state: RepoState = {
			repo,
			root,
			rerun: false,
			generation: 0,
			cache: new Map(),
			subscription: repo.state.onDidChange(() => this.schedule(state)),
		};
		this.repos.set(root, state);
		this.log.debug(`Watching repository ${root}`);
		this.schedule(state, 0);
	}

	private removeRepository(repo: Repository): void {
		const root = repo.rootUri.fsPath;
		const state = this.repos.get(root);
		if (!state) {
			return;
		}
		clearTimeout(state.timer);
		state.generation++;
		state.subscription.dispose();
		this.repos.delete(root);
		this.store.clearRepository(root);
	}

	private schedule(state: RepoState, delay = DEBOUNCE_MS): void {
		clearTimeout(state.timer);
		state.timer = setTimeout(() => void this.run(state), delay);
	}

	/** Starts a check, or cancels the running one and queues a new one. Resolves when checks settle. */
	private run(state: RepoState): Promise<void> {
		if (state.running) {
			state.rerun = true;
			state.generation++;
			return state.running;
		}
		const running = this.check(state)
			.catch((e) => this.log.error(`Check failed for ${state.root}: ${e instanceof Error ? e.message : e}`))
			.finally(() => {
				state.running = undefined;
				if (state.rerun && this.repos.get(state.root) === state) {
					state.rerun = false;
					return this.run(state);
				}
				return undefined;
			});
		state.running = running;
		return running;
	}

	private async check(state: RepoState): Promise<void> {
		const generation = state.generation;
		const cancelled = () => state.generation !== generation;
		const started = Date.now();

		const settings = readSettings(state.repo.rootUri, this.log);
		const git = gitRunner(this.api.git.path, state.root);
		const changes = await listChangedFiles(git, settings.scope);
		if (cancelled()) {
			return;
		}
		if (changes.scope !== settings.scope && state.lastScope !== changes.scope) {
			this.log.info(`${state.root}: the branch has no upstream, so uncommitted changes are checked.`);
		}
		state.lastScope = changes.scope;

		const candidates = changes.files.filter((f) => !settings.isExcluded(f.relativePath));
		if (candidates.length > MAX_FILES) {
			this.log.warn(`${state.root}: ${candidates.length} changed files; checking the first ${MAX_FILES}.`);
			candidates.length = MAX_FILES;
		}

		const languages = new Map(vscode.workspace.textDocuments.map((d) => [d.uri.fsPath, d.languageId]));
		const results = new Map<string, Leftover[]>();
		const cache = new Map<string, CacheEntry>();
		let found = 0;

		for (const file of candidates) {
			const absolute = path.join(state.root, ...file.relativePath.split('/'));
			const entry = await this.scanFile(state, absolute, file, settings, languages.get(absolute));
			if (cancelled()) {
				return;
			}
			if (!entry) {
				continue;
			}
			cache.set(absolute, entry);
			if (entry.findings.length > 0) {
				const uri = vscode.Uri.file(absolute);
				results.set(uri.toString(), entry.findings.map((f) => toLeftover(uri, f)));
				found += entry.findings.length;
			}
		}

		state.cache = cache;
		this.store.setRepository(state.root, results);
		this.log.debug(
			`${state.root}: ${found} leftovers in ${results.size} of ${candidates.length} changed files ` +
				`(${changes.scope}, ${Date.now() - started} ms)`,
		);
	}

	/** Scans one file, or reuses the last result while the file and its added lines are unchanged. */
	private async scanFile(
		state: RepoState,
		absolute: string,
		file: ChangedFile,
		settings: Settings,
		openLanguageId: string | undefined,
	): Promise<CacheEntry | undefined> {
		let stat: fs.Stats;
		try {
			stat = await fs.promises.lstat(absolute);
		} catch {
			return undefined; // deleted since git listed it
		}
		if (!stat.isFile()) {
			return undefined;
		}
		const languageId = openLanguageId ?? languageFromPath(file.relativePath);
		const key = [stat.mtimeMs, stat.size, languageId, file.isNew, JSON.stringify(file.addedLines)].join('|');
		const cached = state.cache.get(absolute);
		if (cached && cached.key === key) {
			return cached;
		}

		// File rules (env-file, large-file) first: they also apply to files too big to read.
		const findings = scanFileInfo(
			{ path: file.relativePath, sizeBytes: stat.size, isNew: file.isNew, largeFileBytes: settings.maxFileBytes },
			settings.fileRules,
		);
		if (stat.size > settings.maxFileBytes || (file.addedLines !== 'all' && file.addedLines.length === 0 && findings.length === 0)) {
			return { key, findings };
		}
		const bytes = await fs.promises.readFile(absolute);
		if (!bytes.subarray(0, 8000).includes(0)) {
			const text = bytes.toString('utf8');
			// Underline the whole first line for file-level findings, so the lightbulb shows there.
			const firstLine = /^[^\r\n]*/.exec(text)![0].length;
			findings.forEach((f) => (f.end = firstLine));
			findings.push(...scanText(text, file.relativePath, languageId, file.addedLines, settings));
		}
		return { key, findings };
	}

	dispose(): void {
		for (const state of this.repos.values()) {
			clearTimeout(state.timer);
			state.generation++;
			state.subscription.dispose();
		}
		this.repos.clear();
		vscode.Disposable.from(...this.disposables).dispose();
	}
}

function toLeftover(uri: vscode.Uri, f: Finding): Leftover {
	return {
		uri,
		range: new vscode.Range(f.line, f.start, f.line, f.end),
		ruleId: f.ruleId,
		severity: f.severity,
		message: f.message,
		label: f.label,
		lineText: f.text,
		fix: f.fix,
	};
}
