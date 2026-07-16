# Rachana (రచన)

**A private, local-first workspace for ideas and visual canvases.**

Rachana means writing, composition, and creation. The app provides a polished
desktop workspace for ordinary local `.excalidraw`, `.md`, and `.markdown` files
without moving personal work into a hosted service.

![Rachana desktop workspace](docs/images/rachana.png)

## Current capabilities

- Electron desktop shell with the same Chromium engine on every platform
- Local folder workspaces with a compact, resizable file tree
- Lazy-loaded Excalidraw editor with self-hosted handwritten and multilingual fonts
- CodeMirror Markdown editor with edit, split, and safe GFM preview modes
- Multiple document tabs with explicit saved, saving, conflict, and recovery states
- Buffered scene persistence and debounced autosave with disk-conflict detection
- Safe Save As handling with filesystem-aware collision protection
- File filtering that preserves folder context and keyboard navigation
- Light, dark, and system themes
- Presentation mode with a laser pointer
- Unified window chrome with grouped, document-aware menus, tabs, and window controls
- Shared New document menus for creating drawings or Markdown notes

All documents remain ordinary files in folders you choose.

## Development

### Prerequisites

- Node.js 26
- npm 11
- A graphical desktop session for Electron development

### Run

```bash
npm ci
npm run dev
```

`npm run dev` starts Electron with Vite-powered renderer hot reload. Native
filesystem and window behavior runs through the context-isolated preload bridge.

### Validate

```bash
npm run typecheck
npm run test:run
npm run test:coverage
npm run build
npm run test:electron
npm run package
```

Current baseline: 31 Vitest files, 190 tests, 71.38% statement coverage, 65.96%
branch coverage, 79.96% function coverage, and 72.29% line coverage, plus one
Playwright Electron workflow.

### Canvas performance

The Excalidraw SDK is loaded only when a drawing is opened. During editing, the
latest scene is buffered and full-document JSON serialization runs after 100 ms
of inactivity instead of on pointer-move frames. Save, Save As, tab lifecycle,
and workspace lifecycle paths flush pending scene data synchronously. Inactive
tabs remain mounted to retain undo history, but are not displayed and run in
view mode with scroll detection disabled. Native file-watcher bursts are
coalesced into one tree refresh and conflict-reconciliation pass.

### Markdown

Markdown files use CodeMirror 6 for editing and a GFM preview for tables, task
lists, strikethrough, and fenced code. Raw HTML is not rendered. Each open note
keeps its own editor and undo history mounted, while preview parsing is deferred
off the keystroke path. Markdown uses the same durable saves, disk-conflict
detection, deleted-file recovery, autosave, and Save As protections as drawings.

Use a production build when comparing responsiveness with excalidraw.com.
React and Excalidraw development builds intentionally include additional checks.
Electron bundles Chromium on Windows, macOS, and Linux, so rendering and pointer
gesture behavior use one engine across platforms. Trackpad pinch changes the
drawing zoom, not the saved document or application UI scale.

### Build

```bash
npm run dist
```

Artifacts are written beneath `release/`. Use `npm run package` for an unpacked
application suitable for local inspection.

## Keyboard shortcuts

| Action | Windows/Linux | macOS |
| --- | --- | --- |
| New drawing | `Ctrl+N` | `Cmd+N` |
| New Markdown note | `Ctrl+Alt+N` | `Cmd+Alt+N` |
| Open folder | `Ctrl+O` | `Cmd+O` |
| New folder | `Ctrl+Shift+N` | `Cmd+Shift+N` |
| Save | `Ctrl+S` | `Cmd+S` |
| Save As | `Ctrl+Shift+S` | `Cmd+Shift+S` |
| Toggle sidebar | `Ctrl+B` | `Cmd+B` |
| Close tab | `Ctrl+W` | `Cmd+W` |
| Switch tabs | `Ctrl+Tab` | `Cmd+Tab` |
| Presentation mode | `F5` | `F5` |
| Full screen | `F11` | `F11` |

## Architecture

- **Desktop runtime:** Electron 43 and bundled Chromium
- **Interface:** React 19, TypeScript, and Vite
- **Canvas engine:** [`@excalidraw/excalidraw`](https://github.com/excalidraw/excalidraw)
- **Text editor:** CodeMirror 6 with `react-markdown` and GFM preview
- **State:** Zustand
- **Filesystem safety:** Electron main-process path/content validation, durable staged writes, expected-content hashes, file identity checks, rollback, and serialized save transactions
- **Recovery:** external modifications and deleted-on-disk documents remain explicit conflict/recovery tabs instead of being overwritten

Frontend coordination lives in `src/`; Electron main/preload code, security
checks, file watching, and durable persistence live in `electron/`. Repository-wide agent
rules live in `.github/copilot-instructions.md`, with path-specific guidance in
`.github/instructions/`.

## License

Rachana is licensed under the [Apache License 2.0](LICENSE).
