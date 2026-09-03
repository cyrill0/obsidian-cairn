# Security policy

## Scope

Cairn is a local Obsidian plugin. The most important security and reliability concerns are unintended modification of vault files, unsafe handling of Markdown or frontmatter, dependency vulnerabilities, and lifecycle leaks that affect Obsidian stability.

## Reporting a vulnerability

Do not disclose a suspected vulnerability in a public issue. Use [GitHub's private vulnerability reporting form](https://github.com/cyrill0/obsidian-cairn/security/advisories/new) for this repository. If private reporting is unavailable, contact the maintainer privately at [github.com/cyrill0](https://github.com/cyrill0) and include:

- A concise description of the issue and its impact.
- Reproduction steps using a non-sensitive test vault.
- The Cairn and Obsidian versions affected.
- A suggested fix or proof of concept, if you have one.

Do not include vault contents, access tokens, or other sensitive data.

GitHub private vulnerability reporting should be enabled in the repository's **Settings -> Code security and analysis**.

## Supported versions

Security fixes are made for the latest released version. Users should update to the latest release before reporting an issue.

## Privacy commitment

Cairn has no network functionality and no telemetry. Any proposed change that adds external communication or data collection requires an explicit user-facing disclosure and maintainer review before release.
