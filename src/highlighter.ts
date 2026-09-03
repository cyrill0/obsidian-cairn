import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";

const todoLineMark = Decoration.mark({ class: "todo-line" });
const doneLineMark = Decoration.mark({ class: "done-line" });

export const todoHighlighter = ViewPlugin.fromClass(class {
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
        const regex = /\b(TODO|DONE):?/g;

        for (const { from, to } of view.visibleRanges) {
            regex.lastIndex = 0;
            const text = view.state.doc.sliceString(from, to);
            let match;
            while ((match = regex.exec(text))) {
                const wordStart = from + match.index;
                const isTodo = match[0].startsWith("TODO");

                const line = view.state.doc.lineAt(wordStart);
                builder.add(line.from, line.to, isTodo ? todoLineMark : doneLineMark);
            }
        }
        return builder.finish();
    }
}, {
    decorations: v => v.decorations
});