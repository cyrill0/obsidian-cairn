import { ItemView, MarkdownView, WorkspaceLeaf, setIcon } from 'obsidian';
import type TodoPlugin from './main';

export const TODO_VIEW_TYPE = 'todo-view';

export interface TodoTarget {
    linktext: string;
    sourcePath: string;
    display: string;
}

export interface TodoEntry {
    text: string;
    filename: string;
    path: string;
    line: number;
    anchorId?: string;
    target?: TodoTarget;
}

export class TodoView extends ItemView {
    private plugin: TodoPlugin;

    constructor(leaf: WorkspaceLeaf, plugin: TodoPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType() { return TODO_VIEW_TYPE; }
    getDisplayText() { return 'Todo list'; }

    async onOpen() {
        this.refreshUI();
    }

    refreshUI() {
        const container = this.containerEl.children[1];
        if (!container) return;

        container.empty();
        container.addClass('todo-panel');

        const todos = this.plugin.allTodos;

        const activeHeader = container.createDiv('todo-header');
        activeHeader.createSpan({ text: 'Todos', cls: 'todo-title' });
        const activeCount = activeHeader.createSpan({ text: String(todos.length), cls: 'todo-count' });
        const refreshBtn = activeHeader.createEl('button', { cls: 'todo-refresh-btn' });
        refreshBtn.setAttribute('aria-label', 'Refresh todos');
        setIcon(refreshBtn, 'refresh-cw');
        refreshBtn.addEventListener('click', () => {
            void this.plugin.loadAllTodos();
        });

        if (todos.length === 0) {
            container.createDiv({ text: 'No todos found.', cls: 'todo-empty' });
            return;
        }

        const activeList = container.createEl('ul', { cls: 'todo-list' });

        let hoveredToggle: (() => void) | null = null;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Enter' && hoveredToggle) hoveredToggle();
        };
        this.registerDomEvent(document as unknown as HTMLElement, 'keydown', onKeyDown as EventListener);

        for (const todo of todos) {
            this.createTodoItem(todo, activeList, activeCount, (fn) => { hoveredToggle = fn; });
        }

        activeCount.setText(String(activeList.children.length));
    }

    private createTodoItem(
        todo: TodoEntry,
        activeList: HTMLElement,
        activeCount: HTMLElement,
        setHovered: (fn: (() => void) | null) => void
    ) {
        const item = activeList.createEl('li', { cls: 'todo-item' });
        item.tabIndex = 0;

        const checkbox = item.createEl('input', { cls: 'todo-checkbox' });
        checkbox.type = 'checkbox';
        checkbox.checked = false;

        const checkIcon = item.createSpan({ cls: 'todo-check-icon' });
        checkIcon.setText('○');

        const textEl = item.createSpan({ cls: 'todo-text' });
        textEl.setText(todo.text.replace(/^[-*]\s*(\[.\]\s*)?/, ''));

        const sourceEl = item.createSpan({ text: todo.filename, cls: 'todo-source' });
        sourceEl.title = todo.path;
        sourceEl.addEventListener('click', (e: MouseEvent) => {
            e.stopPropagation();
            void this.openFileAtLine(todo.path, todo.line);
        });

        if (todo.target) {
            const targetEl = item.createSpan({ text: todo.target.display, cls: 'todo-target' });
            targetEl.title = todo.target.linktext;
            targetEl.addEventListener('click', (e: MouseEvent) => {
                e.stopPropagation();
                void this.openTarget(todo.target!);
            });
        }

        const toggle = () => {
            item.remove();
            activeCount.setText(String(activeList.children.length));
            void this.plugin.toggleTodoCheckbox(todo);
        };

        item.addEventListener('click', toggle);
        item.addEventListener('mouseenter', () => setHovered(toggle));
        item.addEventListener('mouseleave', () => setHovered(null));
    }

    private async openTarget(target: TodoTarget) {
        await this.plugin.app.workspace.openLinkText(target.linktext, target.sourcePath, 'tab');
    }

    private async openFileAtLine(filePath: string, line: number) {
        const file = this.plugin.app.vault.getFileByPath(filePath);
        if (!file) return;

        const { workspace } = this.plugin.app;
        let leaf = workspace.getLeavesOfType('markdown').find(
            (l) => l.view instanceof MarkdownView && l.view.file?.path === filePath
        );

        if (!leaf) {
            leaf = workspace.getLeaf('tab');
            await leaf.openFile(file);
        } else {
            await workspace.revealLeaf(leaf);
        }

        if (leaf.view instanceof MarkdownView && leaf.view.editor) {
            leaf.view.editor.setCursor({ line, ch: 0 });
            leaf.view.editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, true);
            leaf.view.editor.focus();
        }
    }
}
