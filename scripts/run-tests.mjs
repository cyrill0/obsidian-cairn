import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, '..');
const outputDir = await mkdtemp(join(tmpdir(), 'cairn-tests-'));
const outputFile = join(outputDir, 'todo-plugin.test.mjs');

try {
	await build({
		entryPoints: [join(projectRoot, 'tests/todo-plugin.test.mjs')],
		bundle: true,
		format: 'esm',
		platform: 'node',
		target: 'node22',
		outfile: outputFile,
		plugins: [{
			name: 'mock-obsidian-api',
			setup(buildContext) {
				buildContext.onResolve({ filter: /^obsidian$/ }, () => ({
					path: join(projectRoot, 'tests/mocks/obsidian.ts'),
				}));
			},
		}],
	});

	const exitCode = await new Promise((resolveExit) => {
		const child = spawn(process.execPath, [outputFile], {
			cwd: projectRoot,
			stdio: 'inherit',
		});
		child.on('exit', (code) => resolveExit(code ?? 1));
		child.on('error', () => resolveExit(1));
	});

	if (exitCode !== 0) process.exitCode = exitCode;
} finally {
	await rm(outputDir, { force: true, recursive: true });
}
