import * as assert from 'assert';
import type { Finding } from '../model';
import { languageFromPath } from '../languages';
import { ignoreMatcher } from '../match';
import { activeFileRules, activeRules } from '../rules';
import { customRules } from '../rules/custom';
import { envFile, formatSize, largeFile } from '../rules/fileRules';
import { scanFileInfo, scanText } from '../scanner';

function scan(path: string, lines: string[]): Finding[] {
	return scanText(lines.join('\n'), path, languageFromPath(path), 'all', {
		rules: activeRules({}),
		ignore: ignoreMatcher(['console.warn', 'console.error']),
		ignoreComment: 'leftover-ignore',
	});
}

/** "line:ruleId:message" for each finding of one rule. */
function hits(findings: Finding[], ruleId: string): string[] {
	return findings.filter((f) => f.ruleId === ruleId).map((f) => `${f.line}:${f.message}`);
}

const GITHUB_TOKEN = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8';

suite('safety rules', () => {
	test('secret: recognizable tokens and private keys', () => {
		const findings = scan('src/config.ts', [
			'const id = "AKIAIOSFODNN7EXAMPLE";',
			`const auth = { token: "${GITHUB_TOKEN}" };`,
			'-----BEGIN OPENSSH PRIVATE KEY-----',
			'-----BEGIN PUBLIC KEY-----',
		]);
		assert.deepStrictEqual(hits(findings, 'secret'), [
			'0:Possible secret: AWS access key ID',
			'1:Possible secret: GitHub token',
			'2:Possible secret: private key',
		]);
		assert.strictEqual(findings.filter((f) => f.ruleId === 'secret')[0].severity, 'error');
	});

	test('secret: hard-coded values for secret-looking names, but not placeholders or code', () => {
		const findings = scan('src/a.ts', [
			'const apiKey = "sd8f7g6sdf8g7";',
			'const config = { "password": "hunter2hunter2" };',
			'// token = "q9w8e7r6t5y4"',
			'const password = "your-password-here";',
			'const token = getToken("abcdefghijkl");',
			'const tokenizer = "bert-base-uncased";',
			'const msg = "Please enter your password";',
			'const secret = process.env.SECRET;',
			'const dbPassword = "${DB_PASSWORD}";',
			'const key = "xxxxxxxxxxxx";',
		]);
		assert.deepStrictEqual(hits(findings, 'secret'), [
			'0:Possible secret: hard-coded apiKey',
			'1:Possible secret: hard-coded password',
			'2:Possible secret: hard-coded token',
		]);
		const [first] = findings;
		assert.deepStrictEqual([first.start, first.end], [16, 29]); // just the value
	});

	test('secret: unquoted values in config files', () => {
		const env = scan('.env', ['API_KEY=abcd1234efgh5678', 'EMPTY_TOKEN=', 'OTHER_SECRET=${FROM_VAULT}', '# API_KEY=abcd1234efgh5678', 'PORT=3000']);
		assert.deepStrictEqual(hits(env, 'secret'), ['0:Possible secret: API_KEY value']);
		const yaml = scan('app.yml', ['db:', '  password: s3cr3tP4ss', '  user: admin']);
		assert.deepStrictEqual(hits(yaml, 'secret'), ['1:Possible secret: password value']);
		// Unquoted right-hand sides in code are expressions, not secrets.
		assert.deepStrictEqual(hits(scan('a.py', ['password = os.environ["DB_PASSWORD"]']), 'secret'), []);
	});

	test('print: debug output per language', () => {
		assert.deepStrictEqual(hits(scan('a.py', ['print("x")', 'self.print(x)', '# print(x)', 'pprint(data)', 'x = "print(1)"']), 'print'), [
			'0:print() left in code',
			'3:pprint() left in code',
		]);
		assert.deepStrictEqual(hits(scan('A.java', ['System.out.println("x");', 'System.err.printf("%d", 1);', 'logger.info("x");']), 'print'), [
			'0:System.out.println left in code',
			'1:System.err.printf left in code',
		]);
		assert.deepStrictEqual(hits(scan('a.go', ['fmt.Println(x)', 'println("dbg")', 's := fmt.Sprintf("%d", 1)']), 'print'), [
			'0:fmt.Println left in code',
			'1:println left in code',
		]);
		assert.deepStrictEqual(hits(scan('a.rs', ['let y = dbg!(x);', 'println!("hi");']), 'print'), ['0:dbg! left in code']);
		assert.deepStrictEqual(hits(scan('a.php', ['var_dump($x);', 'print_r($y);', 'dd($z);', '$obj->dd(1);']), 'print'), [
			'0:var_dump left in code',
			'1:print_r left in code',
			'2:dd left in code',
		]);
		assert.deepStrictEqual(hits(scan('a.js', ['print(x)']), 'print'), []);
	});

	test('env-file and large-file', () => {
		const info = { sizeBytes: 10, isNew: true, largeFileBytes: 1024 * 1024 };
		const env = (path: string) => envFile.check({ ...info, path })?.label;
		assert.strictEqual(env('.env'), 'env file');
		assert.strictEqual(env('config/.env.local'), 'env file');
		assert.strictEqual(env('.env.example'), undefined);
		assert.strictEqual(env('.env.sample'), undefined);
		assert.strictEqual(env('.envrc'), undefined);
		assert.strictEqual(env('src/env.ts'), undefined);

		const big = { path: 'assets/video.mp4', sizeBytes: 3 * 1024 * 1024, isNew: true, largeFileBytes: 1024 * 1024 };
		assert.strictEqual(largeFile.check(big)?.message, 'Large file added (3.0 MB); consider Git LFS or .gitignore.');
		assert.strictEqual(largeFile.check({ ...big, isNew: false }), undefined);
		assert.strictEqual(largeFile.check({ ...big, sizeBytes: 1000 }), undefined);
		assert.strictEqual(formatSize(1536), '2 KB');

		const findings = scanFileInfo({ ...big, path: '.env' }, activeFileRules({ 'large-file': 'error' }));
		assert.deepStrictEqual(
			findings.map((f) => [f.ruleId, f.severity, f.line, f.fix]),
			[
				['env-file', 'error', 0, 'addToGitignore'],
				['large-file', 'error', 0, 'addToGitignore'],
			],
		);
		assert.deepStrictEqual(scanFileInfo({ ...big, path: '.env' }, activeFileRules({ 'env-file': 'off', 'large-file': 'off' })), []);
	});

	test('custom rules', () => {
		const problems: string[] = [];
		const rules = customRules(
			[
				{ id: 'no-localhost', pattern: 'https?://localhost:\\d+', languages: ['typescript'], severity: 'error', message: 'Hard-coded localhost URL' },
				{ id: 'no-pattern', message: 'x' },
				{ id: 'bad-regex', pattern: '(', message: 'x' },
				null,
			],
			(p) => problems.push(p),
		);
		assert.deepStrictEqual(problems, [
			'custom rule "no-pattern" needs an id, a pattern and a message',
			'custom rule "bad-regex" has an invalid pattern: Invalid regular expression: /(/g: Unterminated group',
			'custom rule #4 needs an id, a pattern and a message',
		]);
		const options = { rules, ignore: ignoreMatcher([]), ignoreComment: 'leftover-ignore' };
		const ts = scanText('fetch("http://localhost:3000/a")', 'a.ts', 'typescript', 'all', options);
		assert.deepStrictEqual(ts.map((f) => [f.ruleId, f.severity, f.start, f.end, f.message, f.label]), [
			['no-localhost', 'error', 7, 28, 'Hard-coded localhost URL', 'no-localhost'],
		]);
		assert.deepStrictEqual(scanText('fetch("http://localhost:3000/a")', 'a.py', 'python', 'all', options), []);
	});
});
