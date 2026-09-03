import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import type TodoPlugin from './main';

const todoLineMark = Decoration.mark({ class: "todo-line" });

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function createTodoHighlighter(plugin: TodoPlugin) {
    return ViewPlugin.fromClass(class {
        decorations: DecorationSet;

        constructor(view: EditorView) {
            this.decorations = this.buildDecorations(view);
        }

        update(update: ViewUpdate) {
            if (update.docChanged || update.viewportChanged) {
                this.decorations = this.buildDecorations(update.view);
            }
        }

        buildDecorations(view: EditorView) {
            const builder = new RangeSetBuilder<Decoration>();
            const keyword = plugin.settings?.todoKeyword || 'TODO';
            const regex = new RegExp(`\\b${escapeRegex(keyword)}:?`, 'g');

            for (const { from, to } of view.visibleRanges) {
                const text = view.state.doc.sliceString(from, to);
                let match;
                while ((match = regex.exec(text))) {
                    const wordStart = from + match.index;
                    const line = view.state.doc.lineAt(wordStart);
                    builder.add(line.from, line.to, todoLineMark);
                }
            }
            return builder.finish();
        }
    }, {
        decorations: v => v.decorations
    });
}
