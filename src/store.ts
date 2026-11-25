import * as vscode from 'vscode';
import type { Leftover } from './model';

/**
 * The leftovers found in every repository, grouped by file. Each check replaces the results
 * of one repository; views listen to onDidChange and redraw from here.
 */
export class LeftoverStore implements vscode.Disposable {
	/** Repository root (fsPath) → file URI (string) → leftovers. */
	private readonly byRepo = new Map<string, Map<string, Leftover[]>>();
	private readonly changed = new vscode.EventEmitter<void>();
	readonly onDidChange = this.changed.event;

	setRepository(root: string, files: Map<string, Leftover[]>): void {
		this.byRepo.set(root, files);
		this.changed.fire();
	}

	clearRepository(root: string): void {
		if (this.byRepo.delete(root)) {
			this.changed.fire();
		}
	}

	/** Every file with leftovers, across repositories, with its repository root. */
	*files(): IterableIterator<[uri: vscode.Uri, leftovers: Leftover[], root: string]> {
		for (const [root, files] of this.byRepo) {
			for (const leftovers of files.values()) {
				if (leftovers.length > 0) {
					yield [leftovers[0].uri, leftovers, root];
				}
			}
		}
	}

	/** How many repositories have results (with or without leftovers). */
	get repositoryCount(): number {
		return this.byRepo.size;
	}

	/** Root of the repository whose results include this file. */
	rootOf(uri: vscode.Uri): string | undefined {
		const key = uri.toString();
		for (const [root, files] of this.byRepo) {
			if (files.has(key)) {
				return root;
			}
		}
		return undefined;
	}

	get(uri: vscode.Uri): Leftover[] {
		const key = uri.toString();
		for (const files of this.byRepo.values()) {
			const leftovers = files.get(key);
			if (leftovers) {
				return leftovers;
			}
		}
		return [];
	}

	dispose(): void {
		this.changed.dispose();
	}
}
