import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";

// 1. Define the CSS classes we will apply
const todoMark = Decoration.mark({ class: "todo-badge" });
const doneMark = Decoration.mark({ class: "done-badge" });

// 2. Create the CodeMirror ViewPlugin
export const todoHighlighter = ViewPlugin.fromClass(class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
        this.decorations = this.buildDecorations(view);
    }

    update(update: ViewUpdate) {
        // Only re-scan if the text changes or the user scrolls
        if (update.docChanged || update.viewportChanged) {
            this.decorations = this.buildDecorations(update.view);
        }
    }

    buildDecorations(view: EditorView) {
        const builder = new RangeSetBuilder<Decoration>();

        // Loop through the text currently visible on the screen
        for (let { from, to } of view.visibleRanges) {
            const text = view.state.doc.sliceString(from, to);

            // Add :? to optionally grab the colon without breaking the word boundary
            const regex = /\b(TODO|DONE):?/g;
            let match;

            while ((match = regex.exec(text))) {
                const start = from + match.index;
                const end = start + match[0].length;

                // Change this to .startsWith() because the match might now be "TODO:" 
                // instead of just "TODO"
                if (match[0].startsWith("TODO")) {
                    builder.add(start, end, todoMark);
                } else {
                    builder.add(start, end, doneMark);
                }
            }
        }
        return builder.finish();
    }
}, {
    decorations: v => v.decorations
});