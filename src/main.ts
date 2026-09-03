import { Plugin, TFile, TAbstractFile, WorkspaceLeaf, debounce } from 'obsidian';
import { DEFAULT_SETTINGS, TodoPluginSettings, TodoSettingTab } from './settings';
import { TODO_VIEW_TYPE, TodoView, TodoEntry } from './view';
import { todoHighlighter } from './highlighter';

const ANCHOR_REGEX = /\s*%%tid:[a-zA-Z0-9]+%%/g;

function stripAnchors(text: string): string {
    return text.replace(ANCHOR_REGEX, '').trim();
}

export default class TodoPlugin extends Plugin {
    settings!: TodoPluginSettings;
    allTodos: TodoEntry[] = [];

    private locks = new Map<string, number>();

    private lock(path: string) {
        this.locks.set(path, (this.locks.get(path) ?? 0) + 1);
    }
    private findTargetLineIndex(lines: string[], todo: TodoEntry): number {
        if (lines[todo.line] !== undefined && stripAnchors(lines[todo.line]!) === todo.text) return todo.line;
        // Line may have shifted slightly — search nearby
        for (let delta = 1; delta <= 5; delta++) {
            for (const i of [todo.line - delta, todo.line + delta]) {
                if (i >= 0 && i < lines.length && stripAnchors(lines[i]!) === todo.text) return i;
            }
        }
        return -1;
    }

    private explorerObservers: MutationObserver[] = [];
    private updateFileExplorerDebounced = debounce(() => this.decorateFileExplorer(), 250, true);

    // 2. The Decorator: Compares the DOM against your allTodos array
    private decorateFileExplorer() {
        // Get all files that currently have an UNFINISHED todo
        const activePaths = new Set<string>();
        for (const todo of this.allTodos) {
            if (!/\bDONE:?/.test(todo.text)) {
                activePaths.add(todo.path);
            }
        }

        // Find all file explorer panels (users can have multiple open!)
        const leaves = this.app.workspace.getLeavesOfType('file-explorer');

        for (const leaf of leaves) {
            // Find every file element currently rendered in the tree
            const fileNodes = leaf.view.containerEl.querySelectorAll('.nav-file-title');

            fileNodes.forEach(node => {
                const path = node.getAttribute('data-path');
                if (!path) return;

                // Toggle the CSS class based on our memory state
                if (activePaths.has(path)) {
                    node.classList.add('has-active-todos');
                } else {
                    node.classList.remove('has-active-todos');
                }
            });
        }
    }

    private setupFileExplorerObserver() {
        // Disconnect old observers to prevent memory leaks when layout changes
        this.explorerObservers.forEach(obs => obs.disconnect());
        this.explorerObservers = [];

        const leaves = this.app.workspace.getLeavesOfType('file-explorer');
        for (const leaf of leaves) {
            const observer = new MutationObserver(() => {
                // When a user opens a folder, Obsidian renders new DOM nodes.
                // We debounce the decorator so it doesn't freeze the app during rapid clicks.
                this.updateFileExplorerDebounced();
            });

            // ONLY watch for children being added/removed. 
            // Do NOT watch attributes, or our own class injection will cause an infinite loop!
            observer.observe(leaf.view.containerEl, { childList: true, subtree: true });
            this.explorerObservers.push(observer);
        }

        // Run it once immediately to style currently visible files
        this.updateFileExplorerDebounced();
    }

    private unlock(path: string) {
        const n = (this.locks.get(path) ?? 1) - 1;
        if (n <= 0) this.locks.delete(path);
        else this.locks.set(path, n);
    }

    async toggleTodoCheckbox(todo: TodoEntry) {
        const file = this.app.vault.getFileByPath(todo.path);
        if (!file) return;

        this.lock(todo.path);
        try {
            await this.app.vault.process(file, (content) => {
                const lines = content.split('\n');
                const targetIndex = this.findTargetLineIndex(lines, todo);
                if (targetIndex === -1) return content;
                this.updateFileExplorerDebounced();

                lines.splice(targetIndex, 1);
                return lines.join('\n');
            });
        } finally {
            this.unlock(todo.path);
        }
    }

    async onload() {
        await this.loadSettings();
        await this.loadSettings();

        this.registerView(TODO_VIEW_TYPE, (leaf) => new TodoView(leaf, this));
        this.addRibbonIcon('check-square', 'Cairn', () => {
            this.openTodoPanel().catch(console.error);
        });
        this.addSettingTab(new TodoSettingTab(this.app, this));

        this.addCommand({
            id: 'refresh-todos',
            name: 'Refresh todos',
            callback: () => { void this.loadAllTodos(); },
        });

        this.app.workspace.onLayoutReady(() => {
            this.loadAllTodos()
                .then(() => {
                    this.refreshTodoView();
                })
                .catch(console.error);
        });

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
        this.registerEvent(this.app.workspace.on('layout-change', () => this.setupFileExplorerObserver()));
        this.setupFileExplorerObserver();
    }

    onunload() {
        this.app.workspace.detachLeavesOfType(TODO_VIEW_TYPE);

        // ADD THIS: Kill the observers
        this.explorerObservers.forEach(obs => obs.disconnect());
    }

    async loadAllTodos() {
        this.allTodos = [];
        const files = this.app.vault.getMarkdownFiles();
        for (let i = 0; i < files.length; i++) {
            if (i % 10 === 0) await new Promise(resolve => setTimeout(resolve, 0));
            await this.scanFileForTodos(files[i]!, false);
        }
        this.refreshTodoView();
    }

    async scanFileForTodos(file: TFile, shouldRefresh = true) {
        const content = await this.app.vault.cachedRead(file);
        const tag = (this.app.metadataCache.getFileCache(file)?.frontmatter?.tags as string[] | undefined)?.[0];

        const todosFromFile: TodoEntry[] = content.split('\n').flatMap((line, i) => {
            if (!/\b(TODO|DONE):?/.test(line)) return [];
            return [{ line: i, text: stripAnchors(line), filename: file.basename, path: file.path, tag }];
        });

        this.allTodos = [
            ...this.allTodos.filter((t) => t.path !== file.path),
            ...todosFromFile,
        ];

        if (shouldRefresh) this.refreshTodoView();
        this.updateFileExplorerDebounced();
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
        } else {
            const leaf: WorkspaceLeaf | null = workspace.getLeftLeaf(false);
            if (leaf) {
                await leaf.setViewState({ type: TODO_VIEW_TYPE, active: true });
                await workspace.revealLeaf(leaf);
            }
        }

        await this.loadAllTodos();
    }

    async updateTodoTag(todo: TodoEntry, newTag: string) {
        const file = this.app.vault.getFileByPath(todo.path);
        if (!file) return;

        this.lock(todo.path);
        try {
            await this.app.vault.process(file, (content) => {
                const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
                if (!fmMatch) return content;

                const fm = fmMatch[1]!;
                const updated = fm.match(/^tags:/m)
                    ? fm.replace(/^(tags:\s*\n)((?:[ \t]*-[^\n]*\n)*)/m,
                        (_, key, list) => {
                            const rest = list.replace(/^[ \t]*-[ \t]*[^\n]*\n/m, '');
                            return `${key}- ${newTag}\n${rest}`;
                        })
                    : fm + `\ntags:\n- ${newTag}`;

                return content.replace(fmMatch[1]!, updated);
            });
        } finally {
            this.unlock(todo.path);
        }

        todo.tag = newTag;
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<TodoPluginSettings>);
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}