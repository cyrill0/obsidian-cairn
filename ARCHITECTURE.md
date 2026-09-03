# Cairn Architecture & Developer Guide

This document is a comprehensive technical guide for developers working on **Obsidian Cairn**. It explains the system architecture, design decisions, data flows, Obsidian platform integrations, and critical implementation gotchas.

---

## 1. System Overview

Cairn is a local-first, lightweight task aggregation plugin for Obsidian. It indexes to-do markers (default: `TODO` or `TODO:`) scattered across Markdown notes and provides:
- A dedicated **Sidebar Panel** (`TodoView`) grouping to-dos by note frontmatter tags.
- **Editor Line Highlights** via CodeMirror 6 in Live Preview and Source modes.
- **Reading Mode Badges** via Obsidian's Markdown Post-Processor.
- **File Explorer Indicators** (orange glowing bullets) on notes with active to-dos.
- **Direct Actions**: Jump to note line, delete completed to-do line, open inline wikilinks, and drag-and-drop to-dos to re-tag notes.

### Core Philosophy
- **Notes are the Single Source of Truth:** Cairn maintains an in-memory cache for speed, but never maintains a proprietary database. Notes can be edited outside Obsidian or by other plugins without corrupting state.
- **Safe Atomic Modifications:** File modifications use Obsidian's `app.vault.process()` wrapped in concurrency locks.
- **Zero Latency / High Responsiveness:** Editor scanning uses CodeMirror 6 viewport virtualization (`visibleRanges`), and vault indexing yields execution every 10 files.

---

## 2. Codebase Structure

```
.
├── src/
│   ├── main.ts            # Plugin lifecycle, vault indexing, event handling, file modifications
│   ├── view.ts            # Sidebar panel (ItemView), DOM rendering, drag-and-drop, wikilink parsing
│   ├── highlighter.ts     # CodeMirror 6 ViewPlugin for editor line highlighting
│   └── settings.ts        # Settings interface, defaults, and settings tab UI
├── tests/
│   ├── mocks/
│   │   └── obsidian.ts    # In-memory Obsidian API mock for pure Node.js test runs
│   └── todo-plugin.test.mjs # Unit tests covering indexing, fuzzy line matching, and YAML editing
├── scripts/
│   └── run-tests.mjs      # esbuild test bundler & test runner script
├── styles.css             # UI styling using Obsidian theme CSS variables
├── manifest.json          # Obsidian plugin metadata
├── esbuild.config.mjs     # Build pipeline for production and development
└── ARCHITECTURE.md        # This document
```

---

## 3. Component Architecture & Data Flow

```mermaid
graph TD
    Vault[Obsidian Vault Markdown Files] -->|cachedRead + metadataCache| Main[TodoPlugin / src/main.ts]
    Main -->|In-memory cache: allTodos[]| View[TodoView / src/view.ts]
    Main -->|CM6 ViewPlugin| Editor[CodeMirror 6 Editor / src/highlighter.ts]
    Main -->|MarkdownPostProcessor| Reading[Reading Mode Preview]
    Main -->|MutationObserver + DOM| Explorer[File Explorer Tree]

    View -->|toggleTodoCheckbox: delete line| Vault
    View -->|updateTodoTag: edit YAML frontmatter| Vault
    View -->|openFileAtLine| Editor
```

### Subsystems Breakdown

| Module | Primary Class / Function | Responsibility |
| :--- | :--- | :--- |
| `src/main.ts` | `TodoPlugin` | Plugin lifecycle (`onload`/`onunload`), full vault indexing, file locks, atomic note modifications, File Explorer decoration. |
| `src/view.ts` | `TodoView` | Sidebar `ItemView`, tag-based grouping and sorting, wikilink parsing, item completion, drag-and-drop. |
| `src/highlighter.ts` | `createTodoHighlighter` | CodeMirror 6 `ViewPlugin` applying `.todo-line` decoration to visible editor lines. |
| `src/settings.ts` | `TodoSettingTab` | Obsidian settings tab; controls `todoKeyword` and triggers debounced vault rescanning. |
| `styles.css` | - | Theme-adaptive styles for sidebar, badges, indicators, and line highlights. |

---

## 4. Key Workflows & Implementation Details

### A. Vault Indexing & Scanning (`main.ts`)
- **Triggered by:** Plugin startup (`workspace.onLayoutReady`), ribbon icon click, command palette (`Refresh todos`), or settings change.
- **Batching & Yielding:** Large vaults can have thousands of files. `loadAllTodos()` loops through `vault.getMarkdownFiles()`, and every 10 files it yields execution:
  ```ts
  if (i % 10 === 0) await new Promise(resolve => window.setTimeout(resolve, 0));
  ```
  This prevents the browser event loop from blocking and keeps Obsidian's UI responsive.
- **Metadata Cache:** Uses `app.metadataCache.getFileCache(file)?.frontmatter?.tags` to retrieve note tags in memory without re-parsing YAML manually during scanning.
- **Marker Matching:** Matches `\bKEYWORD:?` against lines. Strips internal anchor comments (`%%tid:...%%`) via `stripAnchors()`.

### B. Safe File Updates & Concurrency (`main.ts`)
When modifying note files (deleting a to-do line or updating frontmatter tags), Cairn implements two critical safeguards:

1. **Reference-Counting Concurrency Lock:**
   ```ts
   private locks = new Map<string, number>();
   private lock(path: string) { ... }
   private unlock(path: string) { ... }
   ```
   Prevents overlapping asynchronous writes to the same note file.

2. **Fuzzy Line Matching (`findTargetLineIndex`):**
   When a user clicks "complete" in the sidebar, the note may have been edited in the editor, shifting line numbers. Cairn does not blindly delete `todo.line`:
   - Checks `lines[todo.line]` first.
   - If not matched, checks outward `+/- 1` to `+/- 5` lines searching for matching text (anchors stripped).
   - If found, deletes the line using `lines.splice(targetIndex, 1)`.

3. **Atomic Processing:**
   Uses Obsidian's `app.vault.process(file, content => ...)` which ensures atomic read-modify-write without disk conflicts.

### C. Drag & Drop Tag Re-Organization (`view.ts` & `main.ts`)
- In `src/view.ts`, each tag group `<ul>` acts as an HTML5 drop target (`dragover`, `drop`).
- The dragged item passes a composite ID (`path:line`) via `e.dataTransfer`.
- Dropping onto a named tag group calls `plugin.updateTodoTag(todo, newTag)`.
- `updateTodoTag` uses regexes to rewrite YAML frontmatter in three scenarios:
  - **Inline Array:** `tags: [a, b]` $\rightarrow$ `tags: [newTag, b]`
  - **Block List:** `tags:\n  - a\n  - b` $\rightarrow$ `tags:\n- newTag\n  - b`
  - **Missing Tags Field:** Appends `tags:\n- newTag` to existing frontmatter block.

### D. Inline Wikilink Parsing (`view.ts`)
Inside `createTodoItem()`:
- Strips markdown list markers (`/^[-*]\s*(\[.\]\s*)?/`).
- Scans for wikilinks using `/\[\[([^\]]+)\]\]/g`.
- Handles alias separation: `[[Target|Display Text]]` uses `Display Text`; `[[Target#Heading]]` uses `Target`.
- Adds a hoverable jump button (`↗`) positioned relative to the `.todo-item` element using offset parent calculation.
- Clicking opens the link in a new tab via `app.workspace.openLinkText(linkText, todo.path, 'tab')`.

### E. CodeMirror 6 Editor Line Highlighter (`highlighter.ts`)
- Implemented as a CodeMirror 6 `ViewPlugin`.
- **Viewport Virtualization:** Instead of scanning the entire document text buffer, `buildDecorations()` iterates only over `view.visibleRanges`:
  ```ts
  for (const { from, to } of view.visibleRanges) {
      const text = view.state.doc.sliceString(from, to);
      ...
  }
  ```
- Uses `view.state.doc.lineAt(wordStart)` to find line start and end offsets, adding `todoLineMark` from `line.from` to `line.to`.
- Updates only on `update.docChanged` or `update.viewportChanged`.

### F. File Explorer Indicators & MutationObserver Gotcha (`main.ts`)
- Cairn highlights files containing active to-dos by appending an orange glowing dot (`.nav-file-title.has-active-todos::after`).
- Because Obsidian dynamically constructs and destroys DOM nodes in the File Explorer when folders are expanded or collapsed, Cairn attaches `MutationObserver` to all open `file-explorer` leaves.
- **CRITICAL GOTCHA:**
  ```ts
  observer.observe(leaf.view.containerEl, { childList: true, subtree: true });
  ```
  The observer MUST observe `childList: true` and `subtree: true` ONLY. **Never** enable `attributes: true`! Because `decorateFileExplorer()` adds/removes class names on DOM elements, observing attributes will trigger an infinite mutation loop that freezes Obsidian.

---

## 5. Testing & Mock Architecture

The test suite runs in pure Node.js without needing Obsidian or Electron:

1. **Test Runner:** `scripts/run-tests.mjs`
   - Uses `esbuild` to bundle `tests/todo-plugin.test.mjs`.
   - Replaces the import of `'obsidian'` with `tests/mocks/obsidian.ts` via an esbuild resolver plugin.
   - Executes the bundled test file using Node's native test runner (`node:test`).
2. **Mock Implementation:** `tests/mocks/obsidian.ts`
   - Provides minimal in-memory stubs for `TFile`, `TAbstractFile`, `Plugin`, `ItemView`, `Setting`, `debounce`, etc.
3. **Running Tests:**
   ```bash
   npm test
   ```

---

## 6. Maintenance & Future Extensions

### How to change to-do completion behavior
Currently, clicking the complete button deletes the source line from the note (`toggleTodoCheckbox` in `main.ts`).
To change this to convert lines to markdown checkboxes (e.g. `- [x]`), update `toggleTodoCheckbox`:
```ts
// Instead of lines.splice(targetIndex, 1);
lines[targetIndex] = lines[targetIndex].replace(/^([-*]\s*\[)[ ](\])/, '$1x$2');
```

### How to add new settings
1. Add property to `TodoPluginSettings` in `src/settings.ts`.
2. Add default value to `DEFAULT_SETTINGS` in `src/settings.ts`.
3. Add a new `Setting` component in `TodoSettingTab.display()`.
4. Access via `this.settings.<propertyName>` in `main.ts` or other modules.

