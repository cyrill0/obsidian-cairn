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

Screenshots can be added to illustrate the sidebar, editor highlighting, and File Explorer indicators:

- `images/sidebar.png`
- `images/editor-highlights.png`
- `images/file-explorer.png`

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

## Commands and interface

- **Refresh todos** rescans every Markdown file in the vault and refreshes the Cairn sidebar.
- The **Cairn** ribbon icon opens the sidebar. If the sidebar is already open, it brings it into view and refreshes the list.
- A note-name button opens the note at the marker's line.
- A marker's circle button removes the entire matching line from its note.
- Dragging a marker onto a named tag group updates the source note's frontmatter tag.

## How Cairn changes notes

Cairn scans vault Markdown files locally. A scan does not add markers or otherwise change their content.

Two actions can modify a note:

- **Complete a marker:** removes the complete source line. This is deliberate and irreversible from within Cairn; use Obsidian's normal Undo command immediately if needed.
- **Move to a tag group:** changes the note's YAML `tags` field. The note must already contain YAML frontmatter, and Cairn uses the first tag as its sidebar group.

Review and back up important notes as you normally would before using any plugin that writes to vault files.

## Limitations

- Selecting a marker's completion button deletes the whole matching line; there is no built-in undo or archive action.
- Refresh the sidebar after editing marker text or creating a new marker outside Cairn.
- Grouping uses the first tag in a note's YAML frontmatter. Dragging is available only when a destination tag group already exists.
- Cairn treats matching text literally; it does not interpret task syntax, due dates, priorities, or nested tasks.

## Troubleshooting

### The sidebar is empty

Run **Refresh todos** and confirm that the note is a Markdown file containing an uppercase standalone `TODO` or `DONE` marker.

### A marker is in the wrong group

Open the source note and check its YAML frontmatter. Cairn uses the first value under `tags`. Edit the frontmatter directly, then run **Refresh todos**.

### A File Explorer indicator is missing

Refresh the list, then collapse and expand the relevant folder. The indicator is only applied to visible File Explorer entries.

### The plugin does not load

For a manual installation, confirm that `main.js`, `manifest.json`, and `styles.css` are directly inside `<your-vault>/.obsidian/plugins/cairn/`, then restart Obsidian and enable Cairn.

## Privacy

Cairn runs entirely locally. It makes no network requests, sends no vault data or telemetry, and only reads or updates Markdown files in the current vault when you use its features.

## Development

This project uses npm and Node.js 18 or later.

```bash
npm install
npm run dev
```

Run the production checks before a release:

```bash
npm run build
npm run lint
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development and review expectations, [SECURITY.md](./SECURITY.md) for vulnerability reporting, and [RELEASING.md](./RELEASING.md) for the release checklist.

## Changelog

### 1.0.0

- Initial release of Cairn.

## License

Licensed under the ISC license. See [LICENSE](./LICENSE).
