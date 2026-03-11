# Obsidian Note Sync

Sync a single note with a GitHub issue using the `gh` CLI. If a note has a `sync` property pointing at an issue URL, the plugin adds **Pull** and **Push** actions so you can keep the note and issue body aligned. Issue metadata is written to note properties; the `sync` property remains local-only.

## Requirements

- Obsidian desktop (the plugin runs `gh` on your machine).
- [`gh` CLI](https://cli.github.com/) installed and authenticated for the target repository.

## Usage

1. Add a frontmatter property to your note:
   ```md
   ---
   sync: https://github.com/owner/repo/issues/123
   ---
   ```
2. Open the note. **Pull issue** and **Push issue** buttons appear in the note header (also available via the command palette).
3. **Pull issue** replaces the note body with the issue body and writes issue metadata into properties (title, state, number, labels, assignees, milestone, repository, updated, issue_url). The `sync` value is preserved.
4. **Push issue** sends the note body back to the linked issue.

## Development

- Install dependencies: `npm install`
- Watch mode: `npm run dev`
- Production build: `npm run build`

Manual install for a vault:

1. Run `npm run build`.
2. Copy `main.js`, `manifest.json`, and `styles.css` into `<vault>/.obsidian/plugins/obsidian-note-sync/`.
