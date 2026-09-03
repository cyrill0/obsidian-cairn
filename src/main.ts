import { Plugin, TFile, TAbstractFile, WorkspaceLeaf, debounce } from 'obsidian';
import { DEFAULT_SETTINGS, TodoPluginSettings, TodoSettingTab } from './settings';
import { TODO_VIEW_TYPE, TodoView, TodoEntry } from './view';
import { todoHighlighter } from './highlighter';

export default class TodoPlugin extends Plugin {
    settings!: TodoPluginSettings;
    allTodos: TodoEntry[] = [];

    private onFileModified = debounce(
        (file: TFile) => {
            this.scanFileForTodos(file).catch(console.error);
        },
        1000,
        true
    );

    private locks = new Map<string, number>();

    private lock(path: string) {
        this.locks.set(path, (this.locks.get(path) ?? 0) + 1);
    }

    private unlock(path: string) {
        const n = (this.locks.get(path) ?? 1) - 1;
        if (n <= 0) this.locks.delete(path);
        else this.locks.set(path, n);
    }

    async toggleTodoCheckbox(filePath: string, originalLineText: string, isChecked: boolean) {
        const file = this.app.vault.getFileByPath(filePath);
        if (!file) return;

        const newLineText = isChecked
            ? originalLineText.replace(/\b(TODO|DONE)(:?)/, 'DONE$2')
            : originalLineText.replace(/\b(TODO|DONE)(:?)/, 'TODO$2');

        const todoIndex = this.allTodos.findIndex(t => t.path === filePath && t.text === originalLineText);
        if (todoIndex !== -1) {
            this.allTodos[todoIndex]!.text = newLineText;
        }

        this.lock(filePath);
        try {
            await this.app.vault.process(file, (content) => content.replace(originalLineText, newLineText));
        } finally {
            this.unlock(filePath);
        }
    }

    async deleteCompletedTodos() {
        const completedPaths = new Set(
            this.allTodos.filter(t => /\bDONE:?/.test(t.text)).map(t => t.path)
        );

        for (const filePath of completedPaths) {
            const file = this.app.vault.getFileByPath(filePath);
            if (!file) continue;

            this.lock(filePath);
            try {
                await this.app.vault.process(file, (content) =>
                    content.split('\n').filter(line => !/\bDONE:?/.test(line)).join('\n')
                );

                const newContent = await this.app.vault.read(file);
                const todosFromFile: TodoEntry[] = newContent
                    .split('\n')
                    .map((line, index) => ({ line: index, text: line.trim(), filename: file.basename, path: file.path }))
                    .filter((entry) => /\b(TODO|DONE):?/.test(entry.text));

                this.allTodos = [
                    ...this.allTodos.filter((t) => t.path !== filePath),
                    ...todosFromFile,
                ];
            } finally {
                this.unlock(filePath);
            }
        }

        this.refreshTodoView();
    }

    async onload() {
        await this.loadSettings();

        this.registerView(TODO_VIEW_TYPE, (leaf) => new TodoView(leaf, this));
        this.addRibbonIcon('check-square', 'Cairn', () => {
            this.openTodoPanel().catch(console.error);
        });
        this.addSettingTab(new TodoSettingTab(this.app, this));

        this.app.workspace.onLayoutReady(() => {
            this.loadAllTodos()
                .then(() => {
                    this.refreshTodoView();
                })
                .catch(console.error);
        });

        this.registerEvent(
            this.app.vault.on('modify', (file: TAbstractFile) => {
                if (file instanceof TFile && file.extension === 'md' && !this.locks.has(file.path)) {
                    this.onFileModified(file);
                }
            })
        );

        this.registerEvent(
            this.app.vault.on('delete', (file: TAbstractFile) => {
                if (file instanceof TFile && file.extension === 'md') {
                    this.allTodos = this.allTodos.filter((t) => t.path !== file.path);
                    this.refreshTodoView();
                }
            })
        );

        this.registerEvent(
            this.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
                if (file instanceof TFile && file.extension === 'md') {
                    this.allTodos = this.allTodos.map((t) =>
                        t.path === oldPath ? { ...t, path: file.path, filename: file.basename } : t
                    );
                    this.refreshTodoView();
                }
            })
        );

        this.registerEditorExtension(todoHighlighter);

        this.registerMarkdownPostProcessor((element) => {
            const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null);
            const regex = /\b(TODO|DONE):?/;
            let node;

            while ((node = walker.nextNode())) {
                const text = node.textContent;
                if (!text || (!text.includes('TODO') && !text.includes('DONE'))) continue;
                if (!regex.test(text)) continue;
                regex.lastIndex = 0;

                const wrapper = createSpan();
                let last = 0;
                let match;
                while ((match = regex.exec(text)) !== null) {
                    wrapper.appendText(text.slice(last, match.index));
                    const badge = wrapper.createSpan({ cls: match[0] === 'TODO' ? 'todo-badge' : 'done-badge' });
                    badge.setText(match[0]);
                    last = match.index + match[0].length;
                }
                wrapper.appendText(text.slice(last));
                node.parentNode?.replaceChild(wrapper, node);
            }
        });
    }

    onunload() { /* Obsidian cleans up leaves automatically */ }

    async loadAllTodos() {
        this.allTodos = [];
        for (const file of this.app.vault.getMarkdownFiles()) {
            await this.scanFileForTodos(file);
        }
    }

    async scanFileForTodos(file: TFile) {
        const content = await this.app.vault.cachedRead(file);
        const todosFromFile: TodoEntry[] = content
            .split('\n')
            .map((line, index) => ({ line: index, text: line.trim(), filename: file.basename, path: file.path }))
            .filter((entry) => /\b(TODO|DONE):?/.test(entry.text));

        this.allTodos = [
            ...this.allTodos.filter((t) => t.path !== file.path),
            ...todosFromFile,
        ];

        this.refreshTodoView();
    }

    refreshTodoView() {
        const leaf = this.app.workspace.getLeavesOfType(TODO_VIEW_TYPE)[0];
        if (leaf) (leaf.view as TodoView).refreshUI();
    }

    async openTodoPanel() {
        const { workspace } = this.app;
        const existingLeaf = workspace.getLeavesOfType(TODO_VIEW_TYPE)[0];

        if (existingLeaf) {
            await workspace.revealLeaf(existingLeaf);
            return;
        }

        const leaf: WorkspaceLeaf | null = workspace.getLeftLeaf(false);
        if (leaf) {
            await leaf.setViewState({ type: TODO_VIEW_TYPE, active: true });
            await workspace.revealLeaf(leaf);
        }
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<TodoPluginSettings>);
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}