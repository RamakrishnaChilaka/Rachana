# Rachana Repository Instructions

Rachana is a production local-first Electron application for ordinary
`.excalidraw` files. It has no account, cloud backend, or browser filesystem
fallback. Preserve file integrity, explicit save state, conflict detection, and
recovery behavior before convenience.

## Ownership

- `electron/` owns filesystem access, path/content validation, durable writes,
  file identity/hash checks, watching, preferences, menus, IPC validation, and
  window lifecycle.
- `electron/preload.ts` exposes the context-isolated typed `window.rachana`
  bridge. The renderer never imports Node or Electron.
- `src/store/useStore.ts` coordinates tabs, save transactions, external changes,
  conflicts, recovery, deletion, and workspace mutation.
- `src/components/ExcalidrawEditor.tsx` owns canvas lifecycle and scene buffering;
  `src/lib/editorSceneSync.ts` owns synchronous flush registration.
- `src/hooks/useFileSystemChangeListener.ts` owns renderer watcher coalescing.
- `src/lib/tabLifecycle.ts`, `saveStatus.ts`, and `path.ts` own their respective
  derived rules. Extend these owners instead of duplicating logic.

## Integrity Invariants

- Identify tab instances by `tabId`, never path. Paths may be reused by recovery
  and conflict workflows.
- Keep cached content/scene, active content, hashes, identity, scene version, and
  lifecycle version coherent. Re-read Zustand state after every `await` before
  committing work.
- Preserve renderer write queues, Save As claims, main-process path queues,
  expected hash/identity checks, no-clobber destinations, durable staging,
  permission preservation, rollback, and serialized external reconciliation.
- `deleted-on-disk` and `modified-on-disk` are unsaved states. Never silently
  overwrite their original paths or clear their indicators.
- Workspace changes, tab closure, deletion, and shutdown resolve every affected
  unsaved tab, not only the visible tab.

## Electron Security

- Keep sandboxing, context isolation, web security, sender/frame validation,
  navigation restrictions, permission denial, and runtime payload schemas.
- Expose named preload methods only. Never expose generic IPC, filesystem APIs,
  Node globals, or Electron objects to the renderer.
- Keep close handling as a main-request/renderer-veto handshake.

## Canvas Performance

- Keep Excalidraw lazy-loaded and full-scene serialization out of pointer hot
  paths. Buffer newest scene data and serialize after editor idle.
- Flush pending scenes before persistence and lifecycle boundaries. Target writes
  by `tabId` and reject stale `sceneVersion` writes.
- The first restored callback establishes the clean baseline. Restoration and
  viewport-only callbacks never mark a drawing dirty.
- Keep inactive editors mounted for undo history, hidden with `display: none`, in
  view mode, with scroll detection disabled. Do not use React `Activity`.
- Resolve menu canvas APIs by active `tabId` with identity-safe cleanup.

## Working Rules

- Start from the owning action/callback/handler and its nearest regression test.
- Add focused tests for each behavior change; async persistence changes require
  stale or concurrent paths.
- Keep edits narrow and use established Radix, Lucide, Zustand, Electron, and
  accessibility patterns.
- Never commit, push, tag, publish, upload, sign, notarize, or create a release
  unless explicitly requested. Never print secrets.

## Validation

Run the narrowest affected test first, then:

```bash
npm run typecheck
npm run test:run
npm run test:coverage
npm run build
npm run test:electron
npm run package
```

Update `README.md`, this file, and
`.github/instructions/testing.instructions.md` together when final test counts or
coverage change. `CLAUDE.md` is only a pointer to this canonical guidance.

Current baseline: 28 Vitest files, 161 tests, 70.54% statement coverage, 65.61%
branch coverage, 78.75% function coverage, and 71.39% line coverage, plus one
Playwright Electron workflow.
