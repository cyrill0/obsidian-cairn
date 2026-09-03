# Cairn

Collect `TODO` and `DONE` markers from across your Obsidian vault in one sidebar.

Cairn keeps lightweight, local task lists close to the notes they belong to. Open the sidebar to review markers, jump back to their source notes, and remove a finished item without leaving the panel.

## Features

- Scans Markdown files for `TODO`, `TODO:`, `DONE`, and `DONE:` markers.
- Shows all matches in a dedicated sidebar, grouped by the first frontmatter tag on each note.
- Opens the source note at the matching line.
- Opens wiki links contained in a todo directly from the sidebar.
- Removes a marker's entire source line when you select its completion button.
- Lets you drag a marker to an existing tag group to update the note's tag.
- Highlights TODO and DONE markers in the editor and reading view.
- Marks files that contain active TODOs in the File Explorer.

## Screenshots

Add these screenshots before publishing the repository or Community directory listing:

1. `images/sidebar.png` — the Cairn sidebar with tagged and untagged markers.
2. `images/editor-highlights.png` — TODO and DONE highlighting in an editor.
3. `images/file-explorer.png` — File Explorer indicators for notes with active TODOs.

Screenshots should use a real vault with non-sensitive sample notes. Once captured, replace this section with image links such as `![Cairn sidebar](./images/sidebar.png)`.

## Installation

### From the Community directory

After Cairn is published, open **Settings → Community plugins**, search for **Cairn**, install it, and enable it.

### Manual installation

1. Download `main.js`, `manifest.json`, and `styles.css` from a Cairn release.
2. Create `<your-vault>/.obsidian/plugins/cairn/`.
3. Copy the three files into that folder.
4. Restart Obsidian, then enable **Cairn** under **Settings → Community plugins**.

## Usage

1. Add markers to your Markdown notes, for example:

   ```md
   TODO: Review the project brief
   - TODO: Prepare [[Launch plan|the launch plan]]
   DONE: Archive the previous brief
   ```

2. Select the Cairn ribbon icon, or run **Refresh todos**, to open or refresh the sidebar.
3. Select a note name to open the marker at its source line.
4. Select the circle next to a marker to remove that entire source line.

To group a note's markers, add YAML frontmatter with a tag:

```md
---
tags:
  - work
---

TODO: Send the project update
```

You can drag a marker into another existing tag group in the sidebar to change its note's tag.

## Supported marker syntax

Cairn recognizes case-sensitive standalone `TODO` and `DONE` words, with an optional colon. Markers can appear in ordinary text or Markdown list items. `todo`, `Todo`, and custom keywords are not currently recognized.

## Limitations

- Selecting a marker's completion button deletes the whole matching line; there is no built-in undo or archive action.
- Refresh the sidebar after editing marker text or creating a new marker outside Cairn.
- Grouping uses the first tag in a note's YAML frontmatter. Dragging is available only when a destination tag group already exists.
- Cairn treats matching text literally; it does not interpret task syntax, due dates, priorities, or nested tasks.

## Privacy

Cairn runs entirely locally. It makes no network requests, sends no vault data or telemetry, and only reads or updates Markdown files in the current vault when you use its features.

## Development

This project uses pnpm and Node.js 22 or later.

```bash
pnpm install --frozen-lockfile
pnpm run dev
```

Run the production checks before a release:

```bash
pnpm run build
pnpm run lint
```

## Changelog

### 1.0.0

- Initial release of Cairn.

## License

Licensed under the ISC license. See [LICENSE](./LICENSE).
