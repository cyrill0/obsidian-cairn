/**
 * @file todo-plugin.test.mjs
 * @description Unit test suite for Cairn plugin core functionality.
 *
 * Tests the plugin's note scanning, anchor stripping, tag extraction, fuzzy line matching,
 * YAML frontmatter manipulation, and custom keyword filtering using Node.js's native test runner.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import TodoPlugin from '../src/main.ts';
import { TFile } from 'obsidian';

/**
 * Creates an in-memory mock Obsidian App environment for a test case.
 *
 * @param options - Initial test fixture parameters.
 * @param options.content - Initial note Markdown content.
 * @param options.tags - Optional array or string representing frontmatter tags.
 * @returns Object containing the mocked app, file fixture, and a helper to inspect current content.
 */
function createApp({ content, tags = [] }) {
	const file = new TFile('projects/plan.md');
	let storedContent = content;
	let currentTags = tags;

	return {
		app: {
			metadataCache: {
				getFileCache: () => ({ frontmatter: { tags: currentTags } }),
			},
			vault: {
				cachedRead: async () => storedContent,
				getFileByPath: (path) => path === file.path ? file : null,
				getMarkdownFiles: () => [file],
				process: async (_target, update) => {
					storedContent = update(storedContent);
				},
			},
			fileManager: {
				processFrontMatter: async (_target, update) => {
					const fmMatch = storedContent.match(/^---\r?\n([\s\S]*?)\r?\n---/);
					if (!fmMatch) return;
					const fm = { tags: Array.isArray(currentTags) ? [...currentTags] : currentTags };
					update(fm);
					currentTags = fm.tags;
					const tagsStr = Array.isArray(currentTags)
						? `tags:\n${currentTags.map(t => `  - ${t}`).join('\n')}`
						: `tags: ${currentTags}`;
					storedContent = storedContent.replace(/^---\r?\n[\s\S]*?\r?\n---/, `---\n${tagsStr}\n---`);
				},
			},
			workspace: {
				getLeavesOfType: () => [],
			},
		},
		file,
		getContent: () => storedContent,
		getTags: () => currentTags,
	};
}

test('scans markers and preserves their source locations', async () => {
	const fixture = createApp({
		content: [
			'Introduction',
			'TODO: Review the release plan %%tid:abc123%%',
			'Regular line without marker',
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

	const todoToRemove = {
		filename: 'plan',
		line: 1,
		path: fixture.file.path,
		text: 'TODO: Remove this',
	};
	const todoToKeep = {
		filename: 'plan',
		line: 1,
		path: fixture.file.path,
		tag: undefined,
		text: 'TODO: Keep this',
	};
	plugin.allTodos = [todoToKeep, todoToRemove];

	await plugin.toggleTodoCheckbox(todoToRemove);

	assert.equal(fixture.getContent(), ['New heading', 'TODO: Keep this', 'Closing line'].join('\n'));
	assert.deepEqual(plugin.allTodos, [todoToKeep]);
});

test('removes a marker from allTodos even if the line was already removed from the file', async () => {
	const fixture = createApp({
		content: ['Line 1', 'Line 2'].join('\n'),
	});
	const plugin = new TodoPlugin(fixture.app);
	const staleTodo = {
		filename: 'plan',
		line: 1,
		path: fixture.file.path,
		text: 'TODO: Stale item',
	};
	plugin.allTodos = [staleTodo];

	await plugin.toggleTodoCheckbox(staleTodo);

	assert.deepEqual(plugin.allTodos, []);
});

test('updates the first tag in frontmatter via processFrontMatter', async () => {
	const fixture = createApp({
		content: '---\ntags:\n  - old\n  - preserved\n---\nTODO: Test',
		tags: ['old', 'preserved'],
	});
	const plugin = new TodoPlugin(fixture.app);
	const todo = { filename: 'plan', line: 4, path: fixture.file.path, text: 'TODO: Test', tag: 'old' };

	await plugin.updateTodoTag(todo, 'new');

	assert.equal(todo.tag, 'new');
	assert.deepEqual(fixture.getTags(), ['new', 'preserved']);
});

test('rejects invalid tag values containing newlines or special characters (H1 protection)', async () => {
	const fixture = createApp({
		content: '---\ntags:\n  - old\n---\nTODO: Test',
		tags: ['old'],
	});
	const plugin = new TodoPlugin(fixture.app);
	const todo = { filename: 'plan', line: 3, path: fixture.file.path, text: 'TODO: Test', tag: 'old' };

	await plugin.updateTodoTag(todo, 'bad\ncssclasses: [evil]');

	assert.equal(todo.tag, 'old');
	assert.deepEqual(fixture.getTags(), ['old']);
});

test('strips only marker keyword on prose lines, preserving surrounding text (M2 protection)', async () => {
	const fixture = createApp({
		content: ['The 2026 budget was approved after the TODO: review by finance.'].join('\n'),
	});
	const plugin = new TodoPlugin(fixture.app);
	const todo = {
		filename: 'plan',
		line: 0,
		path: fixture.file.path,
		text: 'The 2026 budget was approved after the TODO: review by finance.',
	};
	plugin.allTodos = [todo];

	await plugin.toggleTodoCheckbox(todo);

	assert.equal(fixture.getContent(), 'The 2026 budget was approved after the review by finance.');
	assert.deepEqual(plugin.allTodos, []);
});

test('deletes entire line for markdown task or list items', async () => {
	const fixture = createApp({
		content: ['- [ ] TODO: Buy groceries', 'Next task'].join('\n'),
	});
	const plugin = new TodoPlugin(fixture.app);
	const todo = {
		filename: 'plan',
		line: 0,
		path: fixture.file.path,
		text: '- [ ] TODO: Buy groceries',
	};
	plugin.allTodos = [todo];

	await plugin.toggleTodoCheckbox(todo);

	assert.equal(fixture.getContent(), 'Next task');
	assert.deepEqual(plugin.allTodos, []);
});

test('aborts fuzzy match when multiple identical lines exist in window (M3 protection)', async () => {
	const fixture = createApp({
		content: [
			'Line 0',
			'TODO: Duplicate item',
			'Middle line',
			'TODO: Duplicate item',
			'Line 4',
		].join('\n'),
	});
	const plugin = new TodoPlugin(fixture.app);
	// Stale todo pointing at Line 2 (Middle line) between the two duplicates at 1 and 3
	const staleTodo = {
		filename: 'plan',
		line: 2,
		path: fixture.file.path,
		text: 'TODO: Duplicate item',
	};
	plugin.allTodos = [staleTodo];

	await plugin.toggleTodoCheckbox(staleTodo);

	// Neither duplicate should be deleted because the match is ambiguous
	assert.equal(
		fixture.getContent(),
		['Line 0', 'TODO: Duplicate item', 'Middle line', 'TODO: Duplicate item', 'Line 4'].join('\n')
	);
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

test('ignores non-string frontmatter tags (M5 protection)', async () => {
	const fixtureNumber = createApp({ content: 'TODO: Test', tags: [123] });
	const pluginNumber = new TodoPlugin(fixtureNumber.app);
	await pluginNumber.scanFileForTodos(fixtureNumber.file, false);
	assert.equal(pluginNumber.allTodos[0]?.tag, undefined);

	const fixtureObject = createApp({ content: 'TODO: Test', tags: [{ evil: 1 }] });
	const pluginObject = new TodoPlugin(fixtureObject.app);
	await pluginObject.scanFileForTodos(fixtureObject.file, false);
	assert.equal(pluginObject.allTodos[0]?.tag, undefined);
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

test('cancels stale in-flight scans when a newer scan is triggered (Bug 4 race protection)', async () => {
	const fileA = new TFile('notes/a.md');
	const fileB = new TFile('notes/b.md');
	let readDelay = 10;

	const fixture = {
		app: {
			metadataCache: { getFileCache: () => ({ frontmatter: { tags: ['work'] } }) },
			vault: {
				cachedRead: async (f) => {
					if (readDelay > 0) await new Promise((r) => window.setTimeout(r, readDelay));
					return f.path === 'notes/a.md' ? 'TODO: Item A' : 'TODO: Item B';
				},
				getMarkdownFiles: () => [fileA, fileB],
			},
			workspace: { getLeavesOfType: () => [] },
		},
	};

	const plugin = new TodoPlugin(fixture.app);

	// Start first scan (generation 1)
	const scan1 = plugin.loadAllTodos();
	// Immediately start second scan (generation 2) which supersedes scan 1
	const scan2 = plugin.loadAllTodos();

	await Promise.all([scan1, scan2]);

	// Should contain exactly the results from the latest generation, no duplicates
	assert.equal(plugin.allTodos.length, 2);
	assert.deepEqual(
		plugin.allTodos.map((t) => t.text),
		['TODO: Item A', 'TODO: Item B']
	);
});

test('scans created or modified files incrementally (Bug 9 live indexing)', async () => {
	const fixture = createApp({ content: 'Initial note content' });
	const plugin = new TodoPlugin(fixture.app);

	// Initially no todos
	await plugin.scanFileForTodos(fixture.file, false);
	assert.deepEqual(plugin.allTodos, []);

	// Simulate user adding a todo to the note
	await fixture.app.vault.process(fixture.file, () => 'TODO: Newly added item');
	await plugin.scanFileForTodos(fixture.file, false);

	assert.equal(plugin.allTodos.length, 1);
	assert.equal(plugin.allTodos[0]?.text, 'TODO: Newly added item');
});

