/**
 * @file obsidian.ts (test mock)
 * @description In-memory mock implementations of the Obsidian API for Node.js unit testing.
 *
 * During test execution (`npm test`), `scripts/run-tests.mjs` uses an esbuild resolver plugin
 * to redirect imports of the external `obsidian` module to this file.
 * This allows testing core plugin logic (vault scanning, frontmatter parsing, line editing)
 * in pure Node.js without needing an Obsidian runtime or Electron.
 */

export class TAbstractFile {
	path: string;

	constructor(path: string) {
		this.path = path;
	}
}

export class TFile extends TAbstractFile {
	extension = 'md';
	basename: string;
	stat = { mtime: Date.now(), ctime: Date.now(), size: 0 };

	constructor(path: string) {
		super(path);
		this.basename = path.split('/').at(-1)?.replace(/\.md$/, '') ?? path;
	}
}


export class WorkspaceLeaf {}

export class Plugin {
	app: unknown;

	constructor(app: unknown) {
		this.app = app;
	}

	async loadData() { return null; }
	async saveData() {}
	registerView() {}
	addRibbonIcon() {}
	addSettingTab() {}
	addCommand() {}
	registerEvent() {}
	registerEditorExtension() {}
	registerMarkdownPostProcessor() {}
}

export class PluginSettingTab {
	containerEl = { empty() {} };

	constructor(_app: unknown, _plugin: unknown) {}
}

export class ItemView {
	containerEl = { children: [] };
	contentEl = { empty() {}, addClass(_c: string) {} };

	constructor(_leaf: WorkspaceLeaf) {}
	registerDomEvent() {}
}

export class MarkdownView {}

export class FileManager {
	async processFrontMatter(_file: TFile, _fn: (fm: Record<string, unknown>) => void) {}
}

export function setIcon() {}

export function debounce<T extends (...args: never[]) => unknown>(callback: T): T & { cancel: () => void } {
	const fn = callback as T & { cancel: () => void };
	fn.cancel = () => {};
	return fn;
}

export class Setting {
	constructor(_containerEl: unknown) {}

	setName(_name: string) { return this; }

	setDesc(_desc: string) { return this; }

	addText(cb: (text: { setPlaceholder: (p: string) => void; setValue: (v: string) => void; onChange: (fn: (v: string) => void) => void }) => void) {
		cb({ setPlaceholder: () => {}, setValue: () => {}, onChange: () => {} });
		return this;
	}
}
