/**
 * @file view.ts
 * @description Sidebar panel UI (ItemView) for Obsidian Cairn.
 *
 * This module implements the main user interface of Cairn: a dedicated sidebar panel
 * that renders all discovered to-do items across the vault, categorized by frontmatter tags.
 *
 * ## Key Capabilities:
 * - **Tag Grouping & Sorting:** Automatically groups to-do items by the source note's primary
 *   frontmatter tag, with untagged notes grouped at the bottom.
 * - **Completion (Line Deletion):** Clicking a todo's circle button removes that entire line
 *   from the source file via `plugin.toggleTodoCheckbox()`.
 * - **Jump-to-Source:** Clicking a note name opens the file in a tab and scrolls the editor
 *   directly to the target line.
 * - **Inline Wikilink Handling:** Parses Markdown `[[wikilinks]]` inside to-do text, rendering
 *   them as clickable links with hover navigation buttons (`↗`) to open in new tabs.
 * - **Drag & Drop Tag Organization:** Users can drag a to-do item into another tag group
 *   to automatically rewrite the source note's frontmatter tag.
 * - **Keyboard Accessibility:** Supports arrow key navigation and pressing `Enter` to complete items.
 */

import { ItemView, MarkdownView, WorkspaceLeaf, setIcon } from 'obsidian';
import type TodoPlugin from './main';

/**
 * Unique identifier for registering and retrieving the Cairn sidebar view in Obsidian's workspace.
 */
export const TODO_VIEW_TYPE = 'todo-view';

/**
 * In-memory representation of a discovered to-do item.
 */
export interface TodoEntry {
    /** The raw text content of the to-do line (with internal comment anchors stripped). */
    text: string;
    /** The display name of the note (filename without the `.md` extension). */
    filename: string;
    /** The vault-relative path to the markdown file (e.g., `folder/note.md`). */
    path: string;
    /** The 0-indexed line number where the to-do was found at scan time. */
    line: number;
    /** The primary frontmatter tag from the source note, or `undefined` if untagged. */
    tag?: string;
}

/**
 * Sidebar view component displaying the aggregated to-do list.
 * Extends Obsidian's `ItemView` and resides in a workspace sidebar leaf.
 */
export class TodoView extends ItemView {
    /** Reference to the main plugin instance. */
    private plugin: TodoPlugin;

    /**
     * Initializes a new Cairn sidebar view instance.
     *
     * @param leaf - The workspace leaf hosting this view.
     * @param plugin - The Cairn plugin instance.
     */
    constructor(leaf: WorkspaceLeaf, plugin: TodoPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    /**
     * Returns the unique view type string registered with Obsidian.
     */
    getViewType() { return TODO_VIEW_TYPE; }

    /**
     * Returns the display title shown in the workspace tab header.
     */
    getDisplayText() { return 'Todo list'; }

    /**
     * Lifecycle callback invoked when the view is mounted in the workspace.
     * Registers view-scoped keyboard handlers and triggers the initial UI render.
     */
    async onOpen() {
        // Keyboard accessibility: pressing Enter while focused on a todo item simulates clicking its toggle button.
        // Registered once per view lifecycle; Obsidian automatically cleans it up when the leaf closes.
        this.registerDomEvent(this.containerEl, 'keydown', (e: KeyboardEvent) => {
            if (e.key !== 'Enter') return;
            const focused = this.containerEl.querySelector('.todo-item:focus');
            if (!focused) return;
            const btn = focused.querySelector<HTMLButtonElement>('.todo-toggle-btn');
            btn?.click();
        });

        this.refreshUI();
    }

    /**
     * Rebuilds the entire sidebar DOM using the latest `plugin.allTodos` array.
     *
     * Rendering steps:
     * 1. Accesses the scrollable content container (`this.contentEl`).
     * 2. Empties previous contents and creates the header with item count and refresh button.
     * 3. Handles the empty state if no todos exist.
     * 4. Groups todos by their frontmatter `tag` into a Map.
     * 5. Sorts tags alphabetically, placing the untagged group at the end.
     * 6. Creates sections with headers, lists, drag-and-drop dropzones, and item cards.
     */
    refreshUI() {
        const container = this.contentEl;
        if (!container) return;

        container.empty();
        container.addClass('todo-panel');

        const todos = this.plugin.allTodos;

        // --- Header Section ---
        const header = container.createDiv('todo-header');
        header.createSpan({ text: 'Todos', cls: 'todo-title' });
        header.createSpan({ text: String(todos.length), cls: 'todo-count' });
        const refreshBtn = header.createEl('button', { cls: 'todo-refresh-btn' });
        refreshBtn.setAttribute('aria-label', 'Refresh todos');
        setIcon(refreshBtn, 'refresh-cw');
        refreshBtn.addEventListener('click', () => { void this.plugin.loadAllTodos(); });

        // --- Empty State ---
        if (todos.length === 0) {
            container.createDiv({ text: 'No todos found.', cls: 'todo-empty' });
            return;
        }

        // --- Grouping by Frontmatter Tag ---
        const groups = new Map<string, TodoEntry[]>();
        for (const todo of todos) {
            const key = todo.tag ?? '';
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)!.push(todo);
        }

        // Sort keys: named tags alphabetically, untagged ('') always last
        const sortedKeys = [...groups.keys()].sort((a, b) => {
            if (a === '') return 1;
            if (b === '') return -1;
            return a.localeCompare(b);
        });

        // Shared mutable drag context across item drag listeners
        const drag: { sourceList: HTMLElement | null } = { sourceList: null };

        // --- Render Tag Groups ---
        for (const key of sortedKeys) {
            const groupTodos = groups.get(key)!;
            const section = container.createDiv({ cls: 'todo-group' });

            const groupHeader = section.createDiv({ cls: 'todo-group-header' });
            groupHeader.createSpan({ text: key || 'Untagged', cls: 'todo-group-title' });
            groupHeader.createSpan({ text: String(groupTodos.length), cls: 'todo-count' });

            const list = section.createEl('ul', { cls: 'todo-list', attr: { role: 'list' } });

            // HTML5 Drag and Drop: Allow dropping items onto named tag groups to re-tag notes
            list.addEventListener('dragover', (e) => {
                e.preventDefault(); // Required to allow drop
                if (key) list.addClass('todo-drop-target');
            });
            list.addEventListener('dragleave', () => list.removeClass('todo-drop-target'));
            list.addEventListener('drop', (e) => {
                e.preventDefault();
                list.removeClass('todo-drop-target');
                if (!key) return; // Cannot drop onto untagged group
                const todoId = e.dataTransfer?.getData('text/plain');
                if (!todoId) return;
                // todoId is serialized as "path:line"
                const todo = this.plugin.allTodos.find((t) => t.path + ':' + t.line === todoId);
                if (!todo || todo.tag === key) return;
                // Update note frontmatter on disk; UI will re-render once the write finishes
                void this.plugin.updateTodoTag(todo, key).then(() => this.refreshUI());
            });

            // Render individual todo cards
            for (const todo of groupTodos) {
                this.createTodoItem(todo, list, drag);
            }
        }
    }

    /**
     * Renders a single to-do item element into a group list.
     *
     * Builds:
     * - Completion toggle button (`○`) that removes the line from the note.
     * - Formatted text span with inline wikilink parsing (`[[link]]`).
     * - Hoverable external jump button (`↗`) for wikilinks.
     * - Source note badge button that opens the note at the exact line.
     *
     * @param todo - The to-do entry to render.
     * @param list - The parent `<ul>` container element.
     * @param drag - Drag state tracker.
     */
    private createTodoItem(
        todo: TodoEntry,
        list: HTMLElement,
        drag: { sourceList: HTMLElement | null },
    ) {
        const item = list.createEl('li', { cls: 'todo-item', attr: { role: 'listitem' } });
        item.tabIndex = 0;
        item.draggable = true;
        // Composite unique identifier for drag-and-drop operations
        const todoId = todo.path + ':' + todo.line;
        item.dataset.todoId = todoId;
        item.addEventListener('dragstart', (e) => {
            e.dataTransfer?.setData('text/plain', todoId);
            drag.sourceList = list;
        });
        item.addEventListener('click', () => {
            void this.openFileAtLine(todo.path, todo.line);
        });

        // --- Complete / Toggle Button ---
        const toggleBtn = item.createEl('button', { cls: 'todo-toggle-btn todo-check-icon' });
        toggleBtn.setAttribute('aria-label', 'Complete todo');
        toggleBtn.setText('○');
        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            // Disable immediately to prevent double-clicks during disk write
            toggleBtn.disabled = true;
            void this.plugin.toggleTodoCheckbox(todo).then(() => this.refreshUI());
        });

        // --- To-do Text & Wikilink Parser ---
        const textEl = item.createSpan({ cls: 'todo-text' });
        // Strip leading markdown bullet or task checkbox (e.g., "- [ ] ", "* ")
        const raw = todo.text.replace(/^[-*]\s*(\[.\]\s*)?/, '');
        const linkRegex = /\[\[([^\]]+)\]\]/g;
        let last = 0;
        let m;

        // Parse Obsidian wikilinks: [[Note Name]], [[Note Name|Alias]], [[Note Name#Heading]]
        while ((m = linkRegex.exec(raw)) !== null) {
            // Append plain text preceding the link
            if (m.index > last) textEl.appendText(raw.slice(last, m.index));
            const linkText = m[1]!;
            const target = linkText.split('|')[0]!;
            // Resolve display text: prefer pipe alias (Target|Alias), else strip section anchors (#)
            const display = linkText.includes('|') ? linkText.split('|')[1]! : target.split('#')[0]!;
            const linkSpan = textEl.createSpan({ cls: 'todo-inline-link' });
            linkSpan.createSpan({ cls: 'todo-link-text', text: display });
            const linkIcon = linkSpan.createSpan({ cls: 'todo-link-icon', text: '↗' });
            linkIcon.setAttribute('aria-label', `Open ${target}`);

            // Direct click on the link or its jump icon opens the linked note in a tab
            linkSpan.addEventListener('click', (e: MouseEvent) => {
                e.stopPropagation();
                void this.plugin.app.workspace.openLinkText(linkText, todo.path, 'tab');
            });
            last = m.index + m[0].length;
        }
        // Append any remaining text after the last link
        if (last < raw.length) textEl.appendText(raw.slice(last));

        // --- Source Note Badge Button ---
        const sourceEl = item.createEl('button', { text: todo.filename, cls: 'todo-source' });
        sourceEl.setAttribute('aria-label', todo.path);
        sourceEl.addEventListener('click', (e: MouseEvent) => {
            e.stopPropagation();
            void this.openFileAtLine(todo.path, todo.line);
        });
    }

    /**
     * Navigates to a note in the editor and scrolls to the specific to-do line.
     *
     * Leaf management:
     * - Searches existing workspace leaves to see if the file is already open.
     * - If found, reveals that leaf; otherwise, opens the file in a new tab leaf.
     * - Sets the editor cursor to `{ line, ch: 0 }`, scrolls it into view, and focuses the editor.
     *
     * @param filePath - Vault-relative path of the target markdown file.
     * @param line - 0-indexed line number to navigate to.
     */
    private async openFileAtLine(filePath: string, line: number) {
        const file = this.plugin.app.vault.getFileByPath(filePath);
        if (!file) return;

        const { workspace } = this.plugin.app;
        // Check if file is already open in an existing markdown tab
        let leaf = workspace.getLeavesOfType('markdown').find(
            (l) => l.view instanceof MarkdownView && l.view.file?.path === filePath
        );

        if (!leaf) {
            // Not open: create a new tab leaf and open the file
            leaf = workspace.getLeaf('tab');
            await leaf.openFile(file);
        } else {
            // Already open: bring that leaf to the front
            await workspace.revealLeaf(leaf);
        }

        // Set cursor, scroll line into view, and focus editor
        if (leaf.view instanceof MarkdownView && leaf.view.editor) {
            leaf.view.editor.setCursor({ line, ch: 0 });
            leaf.view.editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, true);
            leaf.view.editor.focus();
        }
    }
}

