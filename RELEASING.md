# Releasing Cairn

Use this checklist for every public release.

## Prepare the release

1. Decide the next Semantic Versioning number: `major.minor.patch`.
2. Update `minAppVersion` in `manifest.json` if the release requires a newer Obsidian API.
3. Update `CHANGELOG.md` with user-facing changes, fixes, and migration notes.
4. Run the version bump, for example:

   ```bash
   pnpm version patch
   ```

   The version script keeps `manifest.json` and `versions.json` aligned with `package.json`.

5. Verify that the version in `package.json`, `manifest.json`, and the new key in `versions.json` is identical.
6. Run the release checks:

   ```bash
   pnpm install --frozen-lockfile
   pnpm run build
   pnpm run lint
   pnpm run test
   ```

7. Test `main.js`, `manifest.json`, and `styles.css` in a clean test vault on each supported platform.

## Publish

1. Commit the version and documentation changes.
2. Create and push a Git tag that exactly matches `manifest.json`'s version with a `v` prefix, for example `v1.0.1`.
3. The release workflow creates a draft GitHub release with `main.js`, `manifest.json`, and `styles.css` attached.
4. Verify the assets, release notes, version, and provenance attestation, then publish the draft.

## After publishing

1. Install the release from a clean vault and perform a smoke test.
2. Confirm the Community directory listing points at the released version.
3. Announce the update with a short summary and a link to the changelog.

## Community directory requirements

Before the initial submission, ensure the repository includes an accurate `manifest.json`, this README, and a license. The release tag must match the manifest version and include the release assets. Follow the current [Obsidian submission guide](https://docs.obsidian.md/plugins/releasing/submit-plugin) and [plugin requirements](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins).

## License

This project is licensed under the GNU General Public License v3.0 - see the [LICENSE](LICENSE) file for details.
