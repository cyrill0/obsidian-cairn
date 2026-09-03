# Security policy

## Scope

Cairn is a local Obsidian plugin. The most important security and reliability concerns are unintended modification of vault files, unsafe handling of Markdown or frontmatter, dependency vulnerabilities, and lifecycle leaks that affect Obsidian stability.

## Reporting a vulnerability

Do not disclose a suspected vulnerability in a public issue. Use GitHub's private vulnerability reporting for this repository when it is available. If private reporting is not enabled, contact the maintainer privately through the repository owner's GitHub profile and include:

- A concise description of the issue and its impact.
- Reproduction steps using a non-sensitive test vault.
- The Cairn and Obsidian versions affected.
- A suggested fix or proof of concept, if you have one.

Do not include vault contents, access tokens, or other sensitive data.

## Supported versions

Security fixes are made for the latest released version. Users should update to the latest release before reporting an issue.

## Privacy commitment

Cairn has no network functionality and no telemetry. Any proposed change that adds external communication or data collection requires an explicit user-facing disclosure and maintainer review before release.
