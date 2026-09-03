import { ItemView, MarkdownView, WorkspaceLeaf } from 'obsidian';
import type TodoPlugin from './main';

export const TODO_VIEW_TYPE = 'todo-view';

export interface TodoEntry {
    text: string;
    filename: string;
    path: string;
    line: number;
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

        const doneHeader = container.createDiv('todo-header todo-done-header');
        doneHeader.createSpan({ text: 'Completed', cls: 'todo-title' });
        const doneCount = doneHeader.createSpan({ text: '0', cls: 'todo-count todo-count-done' });
        const deleteAllBtn = doneHeader.createEl('button', { text: 'Delete all', cls: 'todo-delete-all' });
        const doneList = container.createEl('ul', { cls: 'todo-list' });

        deleteAllBtn.addEventListener('click', () => {
            deleteAllBtn.disabled = true;
            deleteAllBtn.setText('Deleting...');
            void this.plugin.deleteCompletedTodos();
        });

        for (const todo of todos) {
            this.createTodoItem(todo, activeList, activeCount, doneList, doneCount, (fn) => { hoveredToggle = fn; });
        }

        activeCount.setText(String(activeList.children.length));
        doneCount.setText(String(doneList.children.length));
    }

    private createTodoItem(
        todo: TodoEntry,
        activeList: HTMLElement,
        activeCount: HTMLElement,
        doneList: HTMLElement,
        doneCount: HTMLElement,
        setHovered: (fn: (() => void) | null) => void
    ) {
        const isDone = /\bDONE:?/.test(todo.text);
        const parentList = isDone ? doneList : activeList;
        const item = parentList.createEl('li', { cls: 'todo-item' });
        item.tabIndex = 0;

        if (isDone) item.addClass('todo-done');

        const checkbox = item.createEl('input', { cls: 'todo-checkbox' });
        checkbox.type = 'checkbox';
        checkbox.checked = isDone;

        const checkIcon = item.createSpan({ cls: 'todo-check-icon' });
        checkIcon.setText(isDone ? '✓' : '○');

        const textEl = item.createSpan({ cls: 'todo-text' });
        textEl.setText(todo.text.replace(/^[-*]\s*(\[.\]\s*)?/, ''));

        const sourceEl = item.createSpan({ text: todo.filename, cls: 'todo-source' });
        sourceEl.title = todo.path;
        sourceEl.addEventListener('click', (e: MouseEvent) => {
            e.stopPropagation();
            void this.openFileAtLine(todo.path, todo.line);
        });

        const toggle = () => {
            checkbox.checked = !checkbox.checked;
            item.toggleClass('todo-done', checkbox.checked);
            checkIcon.setText(checkbox.checked ? '✓' : '○');
            const target = checkbox.checked ? doneList : activeList;
            target.appendChild(item);
            doneCount.setText(String(doneList.children.length));
            activeCount.setText(String(activeList.children.length));
            void this.plugin.toggleTodoCheckbox(todo.path, todo.text, checkbox.checked);
        };

        item.addEventListener('click', toggle);
        item.addEventListener('mouseenter', () => setHovered(toggle));
        item.addEventListener('mouseleave', () => setHovered(null));
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
