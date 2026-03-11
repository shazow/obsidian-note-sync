# Obsidian Note Sync

Sync a single note with a GitHub issue using the GitHub API. If a note has a `sync` property pointing at an issue URL, the plugin adds **Pull** and **Push** actions so you can keep the note and issue body aligned. Issue metadata is written to note properties; the `sync` property remains local-only.

## Requirements

- GitHub auth token with permission to read/write the target issue (store it in plugin settings).
- Optional: [`gh` CLI](https://cli.github.com/) to import the token automatically on desktop.

## Usage

1. Add a frontmatter property to your note:
   ```md
   ---
   sync: https://github.com/owner/repo/issues/123
   ---
   ```
2. In plugin settings, set **GitHub auth token** (or use **Fetch from gh** if available).
3. Open the note. **Pull issue** and **Push issue** buttons appear in the note header; the command palette will also show **Sync note pull** and **Sync note push** when the note has a `sync` property.
4. **Pull issue** replaces the note body with the issue body and writes issue metadata into properties (title, state, number, labels, assignees, milestone, repository, updated, issue_url). The `sync` value is preserved.
5. **Push issue** sends the note body back to the linked issue.

## Development

- Optional environment: `devenv shell` (or `nix develop`) drops you into a shell with Node, npm, Git, and the GitHub CLI via `devenv`.
- Install dependencies: `npm install` (automatically handled by `make` targets).
- Watch mode: `npm run dev` or `make dev`
- Production build: `npm run build` or simply `make`

Manual install for a vault:

1. Run `npm run build`.
2. Copy `main.js`, `manifest.json`, and `styles.css` into `<vault>/.obsidian/plugins/obsidian-note-sync/`.
