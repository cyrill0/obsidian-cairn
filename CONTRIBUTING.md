# Contributing to Cairn

Thanks for helping improve Cairn. Keep changes focused, documented, and safe for users' notes.

## Development setup

Use Node.js 18 or later and npm:

```bash
npm install
npm run dev
```

The development build writes the plugin to `test-vault/.obsidian/plugins/obsidian-cairn/`. Open `test-vault` as an Obsidian vault, then reload the plugin after changing plugin metadata or CSS.

## Before opening a pull request

1. Run `npm run build`.
2. Run `npm run lint`.
3. Test with a separate sample vault. Do not use private or irreplaceable notes for development tests.
4. Check the behaviour for empty vaults, duplicate markers, renamed/deleted notes, YAML frontmatter, wiki links, and a note modified while the sidebar is open.
5. Update the README and changelog when user-facing behaviour changes.

## Code guidelines

- Keep `src/main.ts` focused on plugin lifecycle and delegate new features to focused modules.
- Use the Obsidian API rather than Node.js or Electron APIs so the plugin remains mobile-compatible.
- Treat vault writes as high-risk: preserve unrelated content, await writes, handle failures, and avoid unexpected writes during scans.
- Register listeners and observers through Obsidian's lifecycle helpers, or clean them up during unload.
- Do not add telemetry, network requests, or dependencies without documenting and reviewing the privacy and security impact.

## Pull requests

Describe the user-visible change, manual test coverage, and any behaviour that modifies Markdown or frontmatter. Include before/after screenshots for UI changes using non-sensitive sample notes.

## License

By contributing, you agree that your contributions are licensed under the repository's ISC license.
