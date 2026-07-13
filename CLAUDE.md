# CLAUDE.md

This repository's canonical agent guidance is
`.github/copilot-instructions.md`. Read it before changing code, then load the
matching file from `.github/instructions/` for frontend, testing, Tauri/Rust, or
release work. Those files are model-independent and apply equally to Claude- and
GPT-backed sessions.

## Project Snapshot

Rachana is an implemented local-first Tauri 2 desktop application for editing
ordinary `.excalidraw` files. It uses React 19, TypeScript, Vite, Zustand, Radix
UI, Tailwind CSS, and a Rust backend. It has multi-tab editing, explicit save
status, autosave, external-change conflict detection, deleted-file recovery,
themes, keyboard shortcuts, native menus, and release packaging.

Do not treat this repository as a scaffold. There are no placeholder Tauri file
commands or missing Excalidraw integration tasks.

## Critical Rules

- Rust owns filesystem access, validation, atomic writes, watching, preferences,
  native menus, and window lifecycle. Frontend code coordinates through named
  Zustand actions and registered Tauri commands.
- Preserve `tabId`, hashes, file identity, scene/lifecycle versions, write
  queues, Save As claims, recovery tabs, and external-conflict state across
  asynchronous changes.
- Keep Excalidraw lazy-loaded. Never serialize the full scene or write Zustand
  content in the pointer-move `onChange` hot path.
- Flush buffered scenes before save and lifecycle boundaries, and reject stale
  `sceneVersion` writes.
- Treat the first restored Excalidraw callback as a clean baseline. Restoration
  and viewport-only changes must not mark a drawing dirty.
- Search every frontend caller and native handler registration before changing
  an IPC command or event contract.
- Add focused tests for every behavior change and include stale/concurrent paths
  for async persistence work.

## Validation

Frontend:

```bash
npm run typecheck
npm run test:run
npm run test:coverage
npm run build
```

Rust/Tauri:

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

Linux native commands require the system packages listed in `README.md`. Never
claim native validation passed when those dependencies are unavailable.

Do not push, publish, upload, sign, notarize, or create releases without explicit
user approval.
