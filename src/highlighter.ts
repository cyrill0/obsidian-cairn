/**
 * @file highlighter.ts
 * @description CodeMirror 6 extension providing real-time syntax highlighting for to-do lines in Obsidian's editor.
 *
 * This module integrates with Obsidian's modern editor engine (CodeMirror 6) to highlight
 * lines containing the configured to-do marker keyword (e.g., "TODO:") while typing or scrolling
 * in Live Preview and Source mode.
 *
 * ## Architecture & Performance:
 * - **CodeMirror 6 ViewPlugin:** Encapsulates the highlighter state (`DecorationSet`) tied to the editor view lifecycle.
 * - **Viewport Virtualization:** Instead of scanning the entire document on every keystroke (which would freeze
 *   large notes), the plugin scans only `view.visibleRanges` (the portions of the document currently rendered on-screen).
 * - **RangeSetBuilder:** CodeMirror's high-performance builder for range sets. Decorations are added in ascending order
 *   and finalized into an immutable `DecorationSet`.
 */

import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import type TodoPlugin from './main';

/**
 * CodeMirror mark decoration that adds the `.todo-line` CSS class around the
 * matched to-do keyword. Styled in `styles.css` as a rounded, pill-like highlight.
 */
const todoKeywordMark = Decoration.mark({ class: "todo-line" });

/**
 * Escapes characters with special meaning in regular expressions.
 * Ensures custom marker keywords containing symbols (e.g., "[TODO]") can be safely
 * interpolated into a RegExp constructor.
 *
 * @param s - The raw string to escape.
 * @returns The escaped string safe for use in regular expressions.
 */
function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Creates a CodeMirror 6 `ViewPlugin` that highlights to-do lines in the active editor.
 *
 * Registered via `plugin.registerEditorExtension()` during plugin initialization in `main.ts`.
 *
 * @param plugin - The Cairn plugin instance, used to read the current `todoKeyword` setting.
 * @returns A CodeMirror 6 ViewPlugin extension.
 */
export function createTodoHighlighter(plugin: TodoPlugin) {
    return ViewPlugin.fromClass(class {
        /** The current set of decorations applied to the visible document ranges. */
        decorations: DecorationSet;

        /**
         * Initializes the highlighter when an editor view is mounted.
         *
         * @param view - The CodeMirror editor view instance.
         */
        constructor(view: EditorView) {
            this.decorations = this.buildDecorations(view);
        }

        /**
         * Lifecycle hook called by CodeMirror after any transaction or view update.
         *
         * Only rebuilds decorations if:
         * 1. `update.docChanged` - The text content was edited.
         * 2. `update.viewportChanged` - The user scrolled or the editor window was resized,
         *    revealing new lines that require decoration.
         *
         * @param update - Description of changes in this update cycle.
         */
        update(update: ViewUpdate) {
            if (update.docChanged || update.viewportChanged) {
                this.decorations = this.buildDecorations(update.view);
            }
        }

        /**
         * Computes line decorations for all currently visible ranges in the editor.
         *
         * Traversal logic:
         * 1. Iterates through each visible range `[from, to]` in `view.visibleRanges`.
         * 2. Slices the string content of that visible block.
         * 3. Executes the keyword regex (`\bKEYWORD:?` with the global flag).
         * 4. For each match, calculates its document offset and resolves the line boundaries
         *    (`line.from` to `line.to`) using `view.state.doc.lineAt(wordStart)`.
         * 5. Adds the decoration range to the `RangeSetBuilder`.
         *
         * @param view - The active CodeMirror editor view.
         * @returns An immutable `DecorationSet` covering the visible document lines.
         */
        buildDecorations(view: EditorView) {
            const builder = new RangeSetBuilder<Decoration>();
            const keyword = plugin.settings?.todoKeyword || 'TODO';
            // Match the keyword with word boundaries and an optional trailing colon
            const regex = new RegExp(`\\b${escapeRegex(keyword)}:?`, 'g');

            // Track lines already highlighted to avoid duplicate marks on the same line
            const highlightedLines = new Set<number>();

            for (const { from, to } of view.visibleRanges) {
                const text = view.state.doc.sliceString(from, to);
                let match;
                while ((match = regex.exec(text))) {
                    const wordStart = from + match.index;
                    const line = view.state.doc.lineAt(wordStart);

                    // Only highlight the first keyword match on each line
                    if (highlightedLines.has(line.number)) continue;
                    highlightedLines.add(line.number);

                    // Trim trailing whitespace so the highlight ends at the last
                    // meaningful character of the to-do line
                    const lineText = view.state.doc.sliceString(line.from, line.to);
                    const end = line.from + lineText.trimEnd().length;

                    // Highlight from the keyword through the rest of the line
                    builder.add(wordStart, end, todoKeywordMark);
                }
            }
            return builder.finish();
        }
    }, {
        // Expose decorations to CodeMirror's display layer
        decorations: v => v.decorations
    });
}

