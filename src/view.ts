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
    tag?: string;
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

        const header = container.createDiv('todo-header');
        header.createSpan({ text: 'Todos', cls: 'todo-title' });
        header.createSpan({ text: String(todos.length), cls: 'todo-count' });
        const refreshBtn = header.createEl('button', { cls: 'todo-refresh-btn' });
        refreshBtn.setAttribute('aria-label', 'Refresh todos');
        setIcon(refreshBtn, 'refresh-cw');
        refreshBtn.addEventListener('click', () => { void this.plugin.loadAllTodos(); });

        if (todos.length === 0) {
            container.createDiv({ text: 'No todos found.', cls: 'todo-empty' });
            return;
        }

        const groups = new Map<string, TodoEntry[]>();
        for (const todo of todos) {
            const key = todo.tag ?? '';
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)!.push(todo);
        }

        // Sort: named tags alphabetically, untagged last
        const sortedKeys = [...groups.keys()].sort((a, b) => {
            if (a === '') return 1;
            if (b === '') return -1;
            return a.localeCompare(b);
        });

        let hoveredToggle: (() => void) | null = null;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Enter' && hoveredToggle) hoveredToggle();
        };
        this.registerDomEvent(document as unknown as HTMLElement, 'keydown', onKeyDown as EventListener);

        const drag: { sourceList: HTMLElement | null; sourceCount: HTMLElement | null } = { sourceList: null, sourceCount: null };

        for (const key of sortedKeys) {
            const groupTodos = groups.get(key)!;
            const section = container.createDiv({ cls: 'todo-group' });

            const groupHeader = section.createDiv({ cls: 'todo-group-header' });
            groupHeader.createSpan({ text: key || 'Untagged', cls: 'todo-group-title' });
            const groupCount = groupHeader.createSpan({ text: String(groupTodos.length), cls: 'todo-count' });

            const list = section.createEl('ul', { cls: 'todo-list' });

            list.addEventListener('dragover', (e) => {
                e.preventDefault();
                if (key) list.addClass('todo-drop-target');
            });
            list.addEventListener('dragleave', () => list.removeClass('todo-drop-target'));
            list.addEventListener('drop', (e) => {
                e.preventDefault();
                list.removeClass('todo-drop-target');
                if (!key) return;
                const todoId = e.dataTransfer?.getData('text/plain');
                if (!todoId) return;
                const todo = this.plugin.allTodos.find((t) => t.path + ':' + t.line === todoId);
                if (!todo || todo.tag === key) return;
                const draggedEl = container.querySelector(`[data-todo-id="${CSS.escape(todoId)}"]`);
                if (draggedEl) list.appendChild(draggedEl);
                if (drag.sourceList && drag.sourceCount)
                    drag.sourceCount.setText(String(drag.sourceList.children.length));
                groupCount.setText(String(list.children.length));
                void this.plugin.updateTodoTag(todo, key);
            });

            for (const todo of groupTodos) {
                this.createTodoItem(todo, list, groupCount, drag, (fn) => { hoveredToggle = fn; });
            }
        }
    }

    private createTodoItem(
        todo: TodoEntry,
        list: HTMLElement,
        groupCount: HTMLElement,
        drag: { sourceList: HTMLElement | null; sourceCount: HTMLElement | null },
        setHovered: (fn: (() => void) | null) => void
    ) {
        const item = list.createEl('li', { cls: 'todo-item' });
        item.tabIndex = 0;
        item.draggable = true;
        const todoId = todo.path + ':' + todo.line;
        item.dataset.todoId = todoId;
        item.addEventListener('dragstart', (e) => {
            e.dataTransfer?.setData('text/plain', todoId);
            drag.sourceList = list;
            drag.sourceCount = groupCount;
        });

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
            groupCount.setText(String(list.children.length));
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
