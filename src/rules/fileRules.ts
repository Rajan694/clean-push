import type { FileRule } from '../model';

/** Example files that are meant to be committed. */
const ENV_EXAMPLE = /\.(example|sample|template|dist|defaults?|schema)$/i;

/** A changed `.env` file that git doesn't ignore (`.env.example` and friends are fine). */
export const envFile: FileRule = {
	id: 'env-file',
	defaultSeverity: 'error',
	fix: 'addToGitignore',
	check(file) {
		const base = file.path.slice(file.path.lastIndexOf('/') + 1);
		if (!/^\.env(\..+)?$/.test(base) || ENV_EXAMPLE.test(base)) {
			return undefined;
		}
		return { message: `${base} would be pushed: it usually holds secrets. Add it to .gitignore.`, label: 'env file' };
	},
};

/** A newly added file bigger than cleanPush.largeFileKB. */
export const largeFile: FileRule = {
	id: 'large-file',
	defaultSeverity: 'warning',
	fix: 'addToGitignore',
	check(file) {
		if (!file.isNew || file.sizeBytes <= file.largeFileBytes) {
			return undefined;
		}
		return { message: `Large file added (${formatSize(file.sizeBytes)}); consider Git LFS or .gitignore.`, label: 'large file' };
	},
};

export function formatSize(bytes: number): string {
	if (bytes >= 1024 * 1024) {
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}
	return `${Math.round(bytes / 1024)} KB`;
}
