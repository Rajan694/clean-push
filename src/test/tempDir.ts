import * as fs from 'fs';
import * as path from 'path';

/**
 * Deletes a temporary folder, git repositories included. Git writes every file under
 * .git/objects read-only, and inside VS Code (Electron) fs.rmSync can't delete read-only
 * files on Windows: Electron builds Node with libc++, whose std::filesystem::remove keeps
 * the read-only attribute, so the call fails with EPERM. Clearing it first avoids that.
 */
export function removeTempDir(dir: string): void {
	if (process.platform === 'win32') {
		makeWritable(dir);
	}
	fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

function makeWritable(dir: string): void {
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		const file = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			makeWritable(file);
		} else if (entry.isFile()) {
			fs.chmodSync(file, 0o666);
		}
	}
}
