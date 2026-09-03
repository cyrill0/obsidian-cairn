/*
 * Obsidian Cairn
 * Copyright (C) 2026 Cyrill
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * @file main.ts
 * @description Central plugin entry point for Obsidian Cairn.
 *
 * Cairn scans Markdown files across the Obsidian vault for configurable marker keywords
 * (default: "TODO"), aggregates them into an interactive sidebar panel, highlights them
 * in the editor and reading view, and visually marks files with active to-dos in the File Explorer.
 *
 * ## Architecture & Subsystems:
 * 1. **Lifecycle & Registrations:** Initializes commands, ribbon icons, settings tab,
 *    CodeMirror editor extensions, reading mode post-processors, and event listeners.
 * 2. **Vault Indexing & Cache:** Cooperative asynchronous scanning (`loadAllTodos`, `scanFileForTodos`)
 *    that yields execution to the main thread every 10 files to keep Obsidian responsive.
 * 3. **File Explorer Badging:** DOM-based decoration (`decorateFileExplorer`) that injects glowing
 *    indicator dots next to file names, kept synchronized via `MutationObserver` on tree view mutations.
 * 4. **Safe Vault Updates:** Atomic note edits (`toggleTodoCheckbox`, `updateTodoTag`) wrapped in
 *    concurrency reference-counting locks and fuzzy line proximity matching (+/- 5 lines)
 *    to handle shifted lines safely.
 * 5. **Reading Mode Badging:** A Markdown post-processor using DOM `TreeWalker` to transform
 *    keyword text in preview mode into styled badges without breaking the document tree.
 */

import { Plugin, TFile, TAbstractFile, WorkspaceLeaf, debounce } from 'obsidian';
import { DEFAULT_SETTINGS, TodoPluginSettings, TodoSettingTab } from './settings';
import { TODO_VIEW_TYPE, TodoView, TodoEntry } from './view';
import { createTodoHighlighter } from './highlighter';

/**
 * Regular expression matching internal task anchor comments in Markdown notes.
 * Format: `%%tid:<alphanumeric>%%` (Obsidian comment syntax).
 * Used to strip internal metadata tags from display text and line comparisons.
 */
/**
 * Allowed characters in Obsidian tags (alphanumerics, underscores, hyphens, and slashes for nested tags).
 * Rejects newlines, quotes, and YAML delimiter injection attempts.
 */
export const TAG_VALIDATION_REGEX = new RegExp('^[a-zA-Z0-9_/-]+$');

/**
 * Regular expression matching internal task anchor comments in Markdown notes.
 * Format: `%%tid:<alphanumeric>%%` (Obsidian comment syntax).
 * Used to strip internal metadata tags from display text and line comparisons.
 */
const ANCHOR_REGEX = /\s*%%tid:[a-zA-Z0-9]+%%/g;

/**
 * Escapes characters with special meaning in regular expressions.
 * Ensures custom marker keywords containing symbols (e.g., "[TODO]") can be safely
 * used within dynamically constructed regular expressions.
 *
 * @param s - The raw string to escape.
 * @returns The regex-escaped string.
 */
function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Strips internal task anchor comments (`%%tid:...%%`) from a line of text and trims whitespace.
 *
 * @param text - The raw text line from a note.
 * @returns Cleaned text suitable for display and comparison.
 */
function stripAnchors(text: string): string {
    return text.replace(ANCHOR_REGEX, '').trim();
}

/**
 * Main plugin class managing the lifecycle, indexing, and UI integrations of Obsidian Cairn.
 */
export default class TodoPlugin extends Plugin {
    /** Persisted user settings (e.g., marker keyword). */
    settings!: TodoPluginSettings;

    /**
     * In-memory cache of all active to-do items found across the vault.
     * Updated during vault scans and mutated when items are completed or re-tagged.
     */
    allTodos: TodoEntry[] = [];

    /** Flag indicating if the plugin is currently unloaded, used to cancel in-flight async loops. */
    private isUnloaded = false;

    /**
     * Per-path Promise mutex queue ensuring sequential, atomic writes to notes.
     */
    private fileMutexes = new Map<string, Promise<void>>();

    /**
     * Executes an async file operation exclusively under a path-specific mutex.
     *
     * @param path - Vault-relative note path.
     * @param fn - Async callback to execute while holding the lock.
     */
    private async withFileLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
        const prev = this.fileMutexes.get(path) ?? Promise.resolve();
        let release: () => void;
        const next = new Promise<void>((resolve) => { release = resolve; });
        this.fileMutexes.set(path, prev.then(() => next, () => next));
        try {
            await prev;
            return await fn();
        } finally {
            release!();
            if (this.fileMutexes.get(path) === next) {
                this.fileMutexes.delete(path);
            }
        }
    }

    /**
     * Locates the exact 0-indexed line in a note corresponding to a given `TodoEntry`.
     *
     * Because users may edit notes while the sidebar is open, line numbers can shift up or down.
     * This method applies proximity search with ambiguity protection:
     * 1. Checks the exact recorded line index first.
     * 2. Searches outward within a +/- 5 line window.
     * 3. If multiple identical matches are found in the window, returns -1 to avoid destroying
     *    the wrong line.
     *
     * @param lines - Array of text lines in the file.
     * @param todo - The to-do entry to locate.
     * @returns The 0-based line index in `lines`, or -1 if the line cannot be unambiguously found.
     */
    private findTargetLineIndex(lines: string[], todo: TodoEntry): number {
        if (lines[todo.line] !== undefined && stripAnchors(lines[todo.line]!) === todo.text) return todo.line;
        // Line may have shifted slightly due to edits — search nearby lines (+/- 5 lines)
        const matches: number[] = [];
        for (let delta = 1; delta <= 5; delta++) {
            for (const i of [todo.line - delta, todo.line + delta]) {
                if (i >= 0 && i < lines.length && stripAnchors(lines[i]!) === todo.text) {
                    if (!matches.includes(i)) matches.push(i);
                }
            }
        }
        // Only accept if exactly one match exists in the window; ambiguous matches return -1
        if (matches.length === 1) return matches[0]!;
        return -1;
    }

    /** Active MutationObserver instances attached to open File Explorer leaves. */
    private explorerObservers: MutationObserver[] = [];

    /**
     * Debounced wrapper (250ms, immediate first invocation) for updating File Explorer badges.
     * Prevents UI stutter during rapid folder expansions or batch file events.
     */
    private updateFileExplorerDebounced = debounce(() => this.decorateFileExplorer(), 250, true);

    /**
     * Debounced wrapper (500ms) for triggering a full vault rescan.
     * Used when settings (e.g. marker keyword) change.
     */
    scheduleRescan = debounce(() => this.loadAllTodos(), 500);

    /**
     * Injects or removes the `.has-active-todos` CSS class on File Explorer tree nodes.
     *
     * This displays an orange glowing dot next to any file currently containing unfinished to-dos.
     * Queries all active 'file-explorer' leaves and matches `.nav-file-title` elements
     * against `allTodos`.
     */
    private decorateFileExplorer() {
        // Collect all file paths that currently contain at least one unfinished todo
        const activePaths = new Set<string>(this.allTodos.map(t => t.path));

        // Find all file explorer panels (users can have multiple split leaves open)
        const leaves = this.app.workspace.getLeavesOfType('file-explorer');

        for (const leaf of leaves) {
            // Query every file title element currently rendered in the explorer tree DOM
            const fileNodes = leaf.view.containerEl.querySelectorAll('.nav-file-title');

            fileNodes.forEach(node => {
                const path = node.getAttribute('data-path');
                if (!path) return;

                // Toggle the CSS class based on whether the file has active todos
                if (activePaths.has(path)) {
                    node.classList.add('has-active-todos');
                } else {
                    node.classList.remove('has-active-todos');
                }
            });
        }
    }

    /**
     * Sets up MutationObservers on all open File Explorer panels.
     *
     * Obsidian dynamically renders and unmounts DOM nodes as folders are expanded or collapsed.
     * The observer listens for DOM tree changes and triggers `updateFileExplorerDebounced()`.
     *
     * @important
     * The observer ONLY watches `childList: true` and `subtree: true`.
     * It must NEVER observe `attributes: true`, because adding or removing `.has-active-todos`
     * modifies the class attribute, which would trigger an infinite mutation loop!
     */
    private setupFileExplorerObserver() {
        // Disconnect existing observers to prevent duplicate listeners and memory leaks
        this.explorerObservers.forEach(obs => obs.disconnect());
        this.explorerObservers = [];

        const leaves = this.app.workspace.getLeavesOfType('file-explorer');
        for (const leaf of leaves) {
            const observer = new MutationObserver(() => {
                // When a folder expands/collapses, new nodes are rendered; re-apply badges
                this.updateFileExplorerDebounced();
            });

            // ONLY watch for children being added or removed.
            // Do NOT watch attributes to prevent recursive mutation loops!
            observer.observe(leaf.view.containerEl, { childList: true, subtree: true });
            this.explorerObservers.push(observer);
        }

        // Run immediately to style currently visible files
        this.updateFileExplorerDebounced();
    }

    /**
     * Completes a to-do item by deleting its source line from the note file.
     *
     * Uses Obsidian's atomic `app.vault.process()` API wrapped in a file lock to ensure
     * safe concurrent writes.
     *
     * @param todo - The to-do item being marked as done.
     */
    async toggleTodoCheckbox(todo: TodoEntry) {
        const file = this.app.vault.getFileByPath(todo.path);
        if (!file) return;

        let targetIndex = -1;
        await this.withFileLock(todo.path, async () => {
            await this.app.vault.process(file, (content) => {
                const lines = content.split('\n');
                targetIndex = this.findTargetLineIndex(lines, todo);
                if (targetIndex === -1) return content;

                const line = lines[targetIndex]!;
                const keyword = this.settings?.todoKeyword || 'TODO';
                const isTaskOrList = /^[-*]\s*(\[[ x]\]\s*)?/i.test(line);
                const isStandaloneMarker = new RegExp(`^\\s*${escapeRegex(keyword)}:?\\s*`, 'i').test(line);

                if (isTaskOrList || isStandaloneMarker) {
                    // Delete the entire line if it's a task/list bullet or standalone marker line
                    lines.splice(targetIndex, 1);
                } else {
                    // Prose line with embedded marker: strip only the marker keyword and trailing colon/space
                    lines[targetIndex] = line.replace(new RegExp(`\\b${escapeRegex(keyword)}:?\\s*`), '');
                }

                return lines.join('\n');
            });
        });

        if (targetIndex !== -1) {
            // Remove the completed to-do item from the in-memory cache
            this.allTodos = this.allTodos.filter(
                (t) => t !== todo && !(t.path === todo.path && t.text === todo.text && t.line === targetIndex)
            );
            // Rescan this file to keep remaining line numbers and state 100% in sync with disk
            await this.scanFileForTodos(file, false);
            this.updateFileExplorerDebounced();
        } else {
            // Line was not found (stale cache / edited externally) - reconcile file with disk
            await this.scanFileForTodos(file, false);
        }
    }

    /**
     * Plugin lifecycle hook called by Obsidian when the plugin is enabled.
     *
     * Sets up:
     * - Settings loading and setting tab registration.
     * - Sidebar `TodoView` registration and ribbon icon.
     * - Commands ('refresh-todos').
     * - Workspace layout initialization (deferred vault scan).
     * - Vault event listeners (delete, rename) to keep cache in sync.
     * - CodeMirror 6 editor highlighter extension.
     * - Reading mode Markdown post-processor for styled badges.
     * - File explorer badge decoration and DOM observers.
     */
    async onload() {
        await this.loadSettings();

        // Register custom sidebar view
        this.registerView(TODO_VIEW_TYPE, (leaf) => new TodoView(leaf, this));

        // Add ribbon icon to open the Cairn sidebar
        this.addRibbonIcon('check-square', 'Cairn', () => {
            this.openTodoPanel().catch(console.error);
        });

        // Add settings tab to Obsidian preferences
        this.addSettingTab(new TodoSettingTab(this.app, this));

        // Add command palette command
        this.addCommand({
            id: 'refresh-todos',
            name: 'Refresh todos',
            callback: () => { void this.loadAllTodos(); },
        });

        // Defer initial vault scan until workspace layout is fully ready
        this.app.workspace.onLayoutReady(() => {
            this.loadAllTodos()
                .then(() => {
                    this.refreshTodoView();
                })
                .catch(console.error);
        });

        // Vault event: remove deleted file's todos from the in-memory cache
        this.registerEvent(
            this.app.vault.on('delete', (file: TAbstractFile) => {
                if (file instanceof TFile && file.extension === 'md') {
                    this.allTodos = this.allTodos.filter((t) => t.path !== file.path);
                    this.refreshTodoView();
                }
            })
        );

        // Vault event: update file path and filename in cached todos when a note is renamed/moved
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

        // Register CodeMirror 6 Live Preview and Source mode line highlighter
        this.registerEditorExtension(createTodoHighlighter(this));

        // Register Markdown Reading Mode post-processor to style keyword matches as badge pills
        this.registerMarkdownPostProcessor((element) => {
            const keyword = this.settings?.todoKeyword || 'TODO';
            // Exclude text nodes inside code blocks, pre tags, and inline code
            const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
                acceptNode(node) {
                    if ((node.parentElement as HTMLElement)?.closest('pre, code, .HyperMD-codeblock')) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    return NodeFilter.FILTER_ACCEPT;
                },
            });
            const regex = new RegExp(`\\b${escapeRegex(keyword)}:?`, 'g');
            let node;

            while ((node = walker.nextNode())) {
                const text = node.textContent;
                if (!text || !text.includes(keyword)) continue;
                regex.lastIndex = 0;
                if (!regex.test(text)) continue;
                regex.lastIndex = 0;

                // Replace matching text node with a fragment containing styled badge spans
                const wrapper = createSpan();
                let last = 0;
                let match;
                while ((match = regex.exec(text))) {
                    wrapper.appendText(text.slice(last, match.index));
                    const badge = wrapper.createSpan({ cls: 'todo-badge' });
                    badge.setText(match[0]);
                    last = match.index + match[0].length;
                }
                wrapper.appendText(text.slice(last));
                node.parentNode?.replaceChild(wrapper, node);
            }
        });

        // Reconnect File Explorer observers when the workspace layout changes
        this.registerEvent(this.app.workspace.on('layout-change', () => this.setupFileExplorerObserver()));
        this.setupFileExplorerObserver();
    }

    /**
     * Plugin lifecycle hook called by Obsidian when the plugin is disabled or reloaded.
     * Cancels active timers, pending rescans, and cleans up all active MutationObservers.
     */
    onunload() {
        this.isUnloaded = true;
        this.updateFileExplorerDebounced.cancel();
        this.scheduleRescan.cancel();
        this.explorerObservers.forEach(obs => obs.disconnect());
    }

    /**
     * Performs a full scan of all Markdown files in the vault.
     *
     * Performance optimization:
     * To prevent freezing the main UI thread in vaults containing thousands of notes,
     * this method processes files in batches of 10, yielding to the browser event loop
     * via `setTimeout(resolve, 0)` between batches.
     */
    async loadAllTodos() {
        this.allTodos = [];
        const files = this.app.vault.getMarkdownFiles();
        for (let i = 0; i < files.length; i++) {
            if (this.isUnloaded) return;
            // Cooperative multitasking: yield to event loop every 10 files
            if (i % 10 === 0) await new Promise(resolve => window.setTimeout(resolve, 0));
            if (this.isUnloaded) return;
            await this.scanFileForTodos(files[i]!, false);
        }
        if (!this.isUnloaded) {
            this.refreshTodoView();
        }
    }

    /**
     * Scans a single Markdown note for lines containing the configured to-do keyword.
     *
     * Reads note content via `app.vault.cachedRead()` and extracts the primary frontmatter
     * tag using `app.metadataCache.getFileCache()`. Replaces existing entries for this file
     * in `allTodos`.
     *
     * @param file - The Markdown file to scan.
     * @param shouldRefresh - Whether to immediately re-render the sidebar UI (defaults to true).
     */
    async scanFileForTodos(file: TFile, shouldRefresh = true) {
        const content = await this.app.vault.cachedRead(file);
        // Extract frontmatter tags from metadata cache; use the first valid string tag
        const rawTags: unknown = this.app.metadataCache.getFileCache(file)?.frontmatter?.tags;
        let tag: string | undefined;
        if (Array.isArray(rawTags) && typeof rawTags[0] === 'string' && TAG_VALIDATION_REGEX.test(rawTags[0])) {
            tag = rawTags[0];
        } else if (typeof rawTags === 'string' && TAG_VALIDATION_REGEX.test(rawTags)) {
            tag = rawTags;
        }

        const keyword = this.settings?.todoKeyword || 'TODO';
        const regex = new RegExp(`\\b${escapeRegex(keyword)}:?`);
        const todosFromFile: TodoEntry[] = content.split('\n').flatMap((line, i) => {
            if (!regex.test(line)) return [];
            return [{ line: i, text: stripAnchors(line), filename: file.basename, path: file.path, tag }];
        });

        // Replace cached todos for this file path with the freshly scanned list
        this.allTodos = [
            ...this.allTodos.filter((t) => t.path !== file.path),
            ...todosFromFile,
        ];

        if (shouldRefresh) this.refreshTodoView();
        this.updateFileExplorerDebounced();
    }

    /**
     * Triggers a re-render of the Cairn sidebar view if it is currently open in the workspace.
     */
    refreshTodoView() {
        const leaf = this.app.workspace.getLeavesOfType(TODO_VIEW_TYPE)[0];
        if (leaf) (leaf.view as TodoView).refreshUI();
    }

    /**
     * Opens or focuses the Cairn sidebar view panel.
     *
     * If the view leaf already exists, it is brought to the front.
     * Otherwise, a new leaf is created in the left sidebar.
     * Initiates a full vault scan once opened.
     */
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

    /**
     * Updates the primary frontmatter tag of a note when a to-do is dragged into a different tag group.
     *
     * Safely updates YAML frontmatter using Obsidian's atomic `app.fileManager.processFrontMatter()` API
     * and strictly validates `newTag` against `TAG_VALIDATION_REGEX` to prevent injection attacks.
     *
     * @param todo - The to-do item whose source note is being updated.
     * @param newTag - The new tag name to assign.
     */
    async updateTodoTag(todo: TodoEntry, newTag: string) {
        if (!TAG_VALIDATION_REGEX.test(newTag)) return;

        const file = this.app.vault.getFileByPath(todo.path);
        if (!file) return;

        let written = false;
        await this.withFileLock(todo.path, async () => {
            await this.app.fileManager.processFrontMatter(file, (rawFm: unknown) => {
                if (!rawFm || typeof rawFm !== 'object') return;
                const fm = rawFm as Record<string, unknown>;
                const tags = fm['tags'];
                if (Array.isArray(tags) && tags.length > 0) {
                    (tags as unknown[])[0] = newTag;
                } else if (typeof tags === 'string') {
                    fm['tags'] = [newTag];
                } else {
                    fm['tags'] = [newTag];
                }
                written = true;
            });
        });

        // If the file update succeeded, update in-memory tag
        if (written) todo.tag = newTag;
    }

    /**
     * Loads plugin settings from Obsidian's data store, merging with defaults.
     */
    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<TodoPluginSettings>);
    }

    /**
     * Persists plugin settings to Obsidian's data store on disk.
     */
    async saveSettings() {
        await this.saveData(this.settings);
    }
}

