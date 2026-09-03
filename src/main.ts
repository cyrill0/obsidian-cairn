import { Plugin, TFile, TAbstractFile, WorkspaceLeaf, debounce } from 'obsidian';
import { DEFAULT_SETTINGS, TodoPluginSettings, TodoSettingTab } from './settings';
import { TODO_VIEW_TYPE, TodoView, TodoEntry } from './view';
import { todoHighlighter } from './highlighter';

export const ANCHOR_REGEX = /\s*%%tid:([a-zA-Z0-9]+)%%/;

export function extractAnchor(text: string): { cleanText: string; anchorId?: string } {
    const match = text.match(ANCHOR_REGEX);
    if (match && match[1]) {
        return {
            cleanText: text.replace(ANCHOR_REGEX, '').trim(),
            anchorId: match[1],
        };
    }
    return { cleanText: text.trim() };
}

export function generateAnchorId(): string {
    return Math.random().toString(36).substring(2, 8);
}

export default class TodoPlugin extends Plugin {
    settings!: TodoPluginSettings;
    allTodos: TodoEntry[] = [];

    private onFileModified = debounce(
        (file: TFile) => {
            this.scanFileForTodos(file).catch(console.error);
        },
        1500,
        true
    );

    private locks = new Map<string, number>();

    private lock(path: string) {
        this.locks.set(path, (this.locks.get(path) ?? 0) + 1);
    }
    private findTargetLineIndex(lines: string[], todo: TodoEntry): number {
        // 1. Escalated case: If an anchor exists, match strictly by ID
        if (todo.anchorId) {
            const anchorTag = `%%tid:${todo.anchorId}%%`;
            const index = lines.findIndex((l) => l.includes(anchorTag));
            if (index !== -1) return index;
        }

        // 2. Common case: Find by exact clean text
        const matches: number[] = [];
        for (let i = 0; i < lines.length; i++) {
            const { cleanText } = extractAnchor(lines[i]!);
            if (cleanText === todo.text) {
                matches.push(i);
            }
        }

        // Exactly one match found (safe to mutate directly)
        if (matches.length === 1) {
            return matches[0]!;
        }

        // 3. Fallback: If multiple unanchored matches collide, use the closest line hint
        if (matches.length > 1) {
            if (matches.includes(todo.line)) return todo.line;
            return matches.reduce((prev, curr) =>
                Math.abs(curr - todo.line) < Math.abs(prev - todo.line) ? curr : prev
            );
        }

        return -1;
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

                lines.splice(targetIndex, 1);
                return lines.join('\n');
            });
        } finally {
            this.unlock(todo.path);
        }
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
            await this.scanFileForTodos(file, false);
        }
        this.refreshTodoView();
    }

    async scanFileForTodos(file: TFile, shouldRefresh = true) {
        const content = await this.app.vault.cachedRead(file);
        const lines = content.split('\n');

        interface ParsedItem {
            lineIndex: number;
            cleanText: string;
            anchorId?: string;
        }

        const parsed: ParsedItem[] = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i]!;
            if (/\b(TODO|DONE):?/.test(line)) {
                const { cleanText, anchorId } = extractAnchor(line);
                parsed.push({
                    lineIndex: i,
                    cleanText,
                    anchorId,
                });
            }
        }

        // Count occurrences to detect collisions
        const counts = new Map<string, number>();
        for (const item of parsed) {
            counts.set(item.cleanText, (counts.get(item.cleanText) ?? 0) + 1);
        }

        // Escalation: inject hidden markers ONLY into colliding lines that lack one
        let modified = false;
        for (const item of parsed) {
            const count = counts.get(item.cleanText) ?? 0;
            if (count > 1 && !item.anchorId) {
                item.anchorId = generateAnchorId();
                lines[item.lineIndex] = `${lines[item.lineIndex]} %%tid:${item.anchorId}%%`;
                modified = true;
            }
        }

        if (modified) {
            this.lock(file.path);
            try {
                await this.app.vault.process(file, () => lines.join('\n'));
            } finally {
                this.unlock(file.path);
            }
        }

        const links = this.app.metadataCache.getFileCache(file)?.links ?? [];

        const todosFromFile: TodoEntry[] = parsed.map((item) => {
            const link = links.find((l) => l.position.start.line === item.lineIndex);
            let target: TodoEntry['target'];
            if (link) {
                const linkedFile = this.app.metadataCache.getFirstLinkpathDest(link.link.split('#')[0]!, file.path);
                if (linkedFile) {
                    const subpath = link.link.includes('#') ? link.link.split('#').slice(1).join('#') : undefined;
                    target = {
                        path: linkedFile.path,
                        subpath,
                        display: link.displayText || linkedFile.basename,
                    };
                }
            }
            return {
                line: item.lineIndex,
                text: item.cleanText,
                filename: file.basename,
                path: file.path,
                anchorId: item.anchorId,
                target,
            };
        });

        this.allTodos = [
            ...this.allTodos.filter((t) => t.path !== file.path),
            ...todosFromFile,
        ];

        if (shouldRefresh) {
            this.refreshTodoView();
        }
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