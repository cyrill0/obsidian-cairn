import assert from 'node:assert/strict';
import test from 'node:test';
import TodoPlugin from '../src/main.ts';
import { TFile } from 'obsidian';

function createApp({ content, tags = [] }) {
	const file = new TFile('projects/plan.md');
	let storedContent = content;

	return {
		app: {
			metadataCache: {
				getFileCache: () => ({ frontmatter: { tags } }),
			},
			vault: {
				cachedRead: async () => storedContent,
				getFileByPath: (path) => path === file.path ? file : null,
				process: async (_target, update) => {
					storedContent = update(storedContent);
				},
			},
			workspace: {
				getLeavesOfType: () => [],
			},
		},
		file,
		getContent: () => storedContent,
	};
}

test('scans markers and preserves their source locations', async () => {
	const fixture = createApp({
		content: [
			'Introduction',
			'TODO: Review the release plan %%tid:abc123%%',
			'DONE: Publish the release notes',
			'notTODO: this is not a marker',
		].join('\n'),
		tags: ['work', 'second-tag'],
	});
	const plugin = new TodoPlugin(fixture.app);

	await plugin.scanFileForTodos(fixture.file, false);

	assert.deepEqual(plugin.allTodos, [
		{
			filename: 'plan',
			line: 1,
			path: 'projects/plan.md',
			tag: 'work',
			text: 'TODO: Review the release plan',
		},
	]);
});

test('removes a marker after nearby lines have shifted', async () => {
	const fixture = createApp({
		content: ['New heading', 'TODO: Keep this', 'TODO: Remove this', 'Closing line'].join('\n'),
	});
	const plugin = new TodoPlugin(fixture.app);

	await plugin.toggleTodoCheckbox({
		filename: 'plan',
		line: 1,
		path: fixture.file.path,
		text: 'TODO: Remove this',
	});

	assert.equal(fixture.getContent(), ['New heading', 'TODO: Keep this', 'Closing line'].join('\n'));
});

test('updates the first tag in inline and block frontmatter lists', async (context) => {
	for (const [name, content, expected] of [
		[
			'inline list',
			'---\ntags: [old, preserved]\n---\nTODO: Test',
			'---\ntags: [new, preserved]\n---\nTODO: Test',
		],
		[
			'block list',
			'---\ntags:\n  - old\n  - preserved\n---\nTODO: Test',
			'---\ntags:\n- new\n  - preserved\n---\nTODO: Test',
		],
	]) {
		await context.test(name, async () => {
			const fixture = createApp({ content });
			const plugin = new TodoPlugin(fixture.app);
			const todo = { filename: 'plan', line: 3, path: fixture.file.path, text: 'TODO: Test', tag: 'old' };

			await plugin.updateTodoTag(todo, 'new');

			assert.equal(fixture.getContent(), expected);
			assert.equal(todo.tag, 'new');
		});
	}
});

test('does not alter a note without frontmatter when updating its tag', async () => {
	const fixture = createApp({ content: 'TODO: Test' });
	const plugin = new TodoPlugin(fixture.app);
	const todo = { filename: 'plan', line: 0, path: fixture.file.path, text: 'TODO: Test', tag: 'old' };

	await plugin.updateTodoTag(todo, 'new');

	assert.equal(fixture.getContent(), 'TODO: Test');
	assert.equal(todo.tag, 'old');
});

test('does not write when the target file is missing', async () => {
	const fixture = createApp({ content: 'TODO: Test' });
	const plugin = new TodoPlugin(fixture.app);

	await plugin.toggleTodoCheckbox({
		filename: 'missing',
		line: 0,
		path: 'missing.md',
		text: 'TODO: Test',
	});

	assert.equal(fixture.getContent(), 'TODO: Test');
});

test('ignores non-array frontmatter tags', async () => {
	const fixture = createApp({ content: 'TODO: Test', tags: 'work' });
	const plugin = new TodoPlugin(fixture.app);

	await plugin.scanFileForTodos(fixture.file, false);

	assert.equal(plugin.allTodos[0]?.tag, undefined);
});

test('uses the configured marker keyword', async () => {
	const fixture = createApp({
		content: [
			'TODO: Should not match with custom keyword',
			'FIXME: This should match',
			'notFIXME: This should not match',
		].join('\n'),
	});
	const plugin = new TodoPlugin(fixture.app);
	plugin.settings = { todoKeyword: 'FIXME' };

	await plugin.scanFileForTodos(fixture.file, false);

	assert.deepEqual(plugin.allTodos, [
		{
			filename: 'plan',
			line: 1,
			path: fixture.file.path,
			tag: undefined,
			text: 'FIXME: This should match',
		},
	]);
});
