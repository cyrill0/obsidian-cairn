import { ItemView, MarkdownView, WorkspaceLeaf, setIcon } from 'obsidian';
import type TodoPlugin from './main';

export const TODO_VIEW_TYPE = 'todo-view';

export interface TodoEntry {
    text: string;
    filename: string;
    path: string;
    line: number;
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
        // Registered once per view lifecycle; Obsidian cleans it up on close
        this.registerDomEvent(this.containerEl, 'keydown', (e: KeyboardEvent) => {
            if (e.key !== 'Enter') return;
            const focused = this.containerEl.querySelector('.todo-item:focus');
            if (!focused) return;
            const btn = focused.querySelector<HTMLButtonElement>('.todo-toggle-btn');
            btn?.click();
        });

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

        const sortedKeys = [...groups.keys()].sort((a, b) => {
            if (a === '') return 1;
            if (b === '') return -1;
            return a.localeCompare(b);
        });

        const drag: { sourceList: HTMLElement | null } = { sourceList: null };

        for (const key of sortedKeys) {
            const groupTodos = groups.get(key)!;
            const section = container.createDiv({ cls: 'todo-group' });

            const groupHeader = section.createDiv({ cls: 'todo-group-header' });
            groupHeader.createSpan({ text: key || 'Untagged', cls: 'todo-group-title' });
            groupHeader.createSpan({ text: String(groupTodos.length), cls: 'todo-count' });

            const list = section.createEl('ul', { cls: 'todo-list', attr: { role: 'list' } });

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
                // No optimistic DOM move — refreshUI will re-render after the write
                void this.plugin.updateTodoTag(todo, key).then(() => this.refreshUI());
            });

            for (const todo of groupTodos) {
                this.createTodoItem(todo, list, drag);
            }
        }
    }

    private createTodoItem(
        todo: TodoEntry,
        list: HTMLElement,
        drag: { sourceList: HTMLElement | null },
    ) {
        const item = list.createEl('li', { cls: 'todo-item', attr: { role: 'listitem' } });
        item.tabIndex = 0;
        item.draggable = true;
        const todoId = todo.path + ':' + todo.line;
        item.dataset.todoId = todoId;
        item.addEventListener('dragstart', (e) => {
            e.dataTransfer?.setData('text/plain', todoId);
            drag.sourceList = list;
        });

        const toggleBtn = item.createEl('button', { cls: 'todo-toggle-btn todo-check-icon' });
        toggleBtn.setAttribute('aria-label', 'Mark as done');
        toggleBtn.setText('○');
        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleBtn.disabled = true;
            void this.plugin.toggleTodoCheckbox(todo).then(() => this.refreshUI());
        });

        const textEl = item.createSpan({ cls: 'todo-text' });
        const raw = todo.text.replace(/^[-*]\s*(\[.\]\s*)?/, '');
        const linkRegex = /\[\[([^\]]+)\]\]/g;
        let last = 0;
        let m;
        while ((m = linkRegex.exec(raw)) !== null) {
            if (m.index > last) textEl.appendText(raw.slice(last, m.index));
            const linkText = m[1]!;
            const display = linkText.includes('|') ? linkText.split('|')[1]! : linkText.split('#')[0]!;
            const linkSpan = textEl.createSpan({ cls: 'todo-inline-link', text: display });
            linkSpan.addEventListener('mouseenter', () => {
                let el: HTMLElement = linkSpan;
                let left = el.offsetLeft + el.offsetWidth;
                let top = el.offsetTop;
                while (el.offsetParent && el.offsetParent !== item) {
                    el = el.offsetParent as HTMLElement;
                    left += el.offsetLeft;
                    top += el.offsetTop;
                }
                linkIcon.style.left = left + 'px';
                linkIcon.style.top = top + 'px';
                linkIcon.addClass('is-visible');
                linkIcon.onclick = (e) => {
                    e.stopPropagation();
                    void this.plugin.app.workspace.openLinkText(linkText, todo.path, 'tab');
                };
            });
            linkSpan.addEventListener('mouseleave', (e) => {
                if (!linkIcon.contains(e.relatedTarget as Node)) linkIcon.removeClass('is-visible');
            });
            linkSpan.addEventListener('click', (e: MouseEvent) => {
                e.stopPropagation();
                void this.plugin.app.workspace.openLinkText(linkText, todo.path, 'tab');
            });
            last = m.index + m[0].length;
        }
        if (last < raw.length) textEl.appendText(raw.slice(last));

        const linkIcon = item.createSpan({ cls: 'todo-link-icon', text: '↗' });
        linkIcon.addEventListener('mouseleave', () => { linkIcon.removeClass('is-visible'); });

        const sourceEl = item.createEl('button', { text: todo.filename, cls: 'todo-source' });
        sourceEl.title = todo.path;
        sourceEl.setAttribute('aria-label', `Open ${todo.filename}`);
        sourceEl.addEventListener('click', (e: MouseEvent) => {
            e.stopPropagation();
            void this.openFileAtLine(todo.path, todo.line);
        });
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
