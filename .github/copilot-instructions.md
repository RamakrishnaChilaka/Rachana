# Rachana Repository Instructions

Rachana is a production local-first Tauri 2 desktop application for ordinary
`.excalidraw` files. It has no account, cloud backend, or browser filesystem
fallback. Preserve file integrity, explicit save state, conflict detection, and
recovery behavior before optimizing for convenience.

## Technology And Ownership

- `src-tauri/` owns filesystem access, path validation, atomic writes, file
  identity/hash checks, watching, preferences persistence, native menus, and
  window lifecycle.
- `src/store/useStore.ts` coordinates tabs, save transactions, external-change
  reconciliation, recovery/conflict state, and workspace mutations.
- `src/components/ExcalidrawEditor.tsx` owns the mounted canvas lifecycle and
  scene buffering. `src/lib/editorSceneSync.ts` is the synchronous flush bridge.
- `src/hooks/useFileSystemChangeListener.ts` owns frontend watcher-event
  coalescing and ensures refreshes do not overlap.
- `src/lib/tabLifecycle.ts` owns close-state classification;
  `src/lib/saveStatus.ts` owns derived save labels; `src/lib/path.ts` owns path
  comparison rules. Extend these owners instead of duplicating their logic.
- React components never access the filesystem directly. They call named store
  actions, which invoke registered Tauri commands.

## Data Integrity Invariants

- A tab instance is identified by `tabId`, not path. Paths may be reused by
  recovery/conflict workflows, so never assume path uniqueness across tabs.
- Keep `cachedContent`, `cachedScene`, `fileContent`, `contentHash`,
  `fileIdentity`, `sceneVersion`, and `lifecycleVersion` coherent. After an
  `await`, re-read Zustand state and validate the snapshot before applying work.
- Preserve per-path write serialization, Save As destination claims, expected
  hash/identity checks, and serialized external reconciliation in
  `useStore.ts`. Do not replace these with an unguarded `invoke()` call.
- `recoveryState: 'deleted-on-disk'` and
  `externalConflict: 'modified-on-disk'` are unsaved states. Never silently
  overwrite their original paths or clear their modified indicators.
- Workspace changes, tab closure, deletion, and app shutdown must resolve every
  affected unsaved tab. Never save only the visible tab when the operation
  affects a wider scope.

## Canvas Performance Invariants

- Keep `@excalidraw/excalidraw` behind a dynamic `import()`. Type-only imports
  from its public type paths are allowed; static runtime imports are not.
- Keep full-scene `JSON.stringify()` and Zustand content writes out of
  Excalidraw's `onChange` pointer hot path. Buffer the newest scene and serialize
  only after editor idle.
- Flush pending scenes synchronously before Save, Save As, workspace resolution,
  tab deactivation, and editor unmount.
- Target buffered writes by `tabId` and reject stale `sceneVersion` writes.
- Use Excalidraw's first restored scene callback as the clean element baseline.
  Restoration and viewport-only callbacks must not mark a file dirty.
- Keep inactive editor panes isolated from active global menu/API state.
- Keep inactive editor panes mounted so Excalidraw history survives tab
  switches. Hide them with `display: none`, use view mode to detach edit-only
  listeners, and disable scroll detection for the fixed editor viewport; do not
  unmount them or use React `Activity`.
- Resolve menu canvas APIs by active `tabId`; registrations and stale cleanup
  must never redirect a command to another tab.

## Working Rules

- Start from the owning action, callback, or native command and its nearest
  regression test. Prefer narrow changes over cross-cutting rewrites.
- Add tests for every behavior change. Race-sensitive changes need tests for the
  stale or concurrent path, not only the happy path.
- Use exact SDK types through type-only imports. Keep unsafe casts at parse or
  synthetic-test boundaries, never in normal editor/store flow.
- Do not add speculative constants, wrappers, compatibility paths, or exports.
  Add an abstraction only when there is a current caller and ownership benefit.
- Preserve the existing Radix UI, Lucide icon, Tailwind/CSS, and accessibility
  patterns. Platform-specific CSS depends on `html[data-platform]`.
- Never commit, push, publish, upload, sign, or create a release unless the user
  explicitly asks. Never print signing credentials or other secrets.

## Validation

For frontend behavior changes, run in order:

1. The narrowest affected Vitest file.
2. `npm run typecheck`
3. `npm run test:run`
4. `npm run test:coverage`
5. `npm run build`

For Rust changes, also run `cargo fmt --manifest-path src-tauri/Cargo.toml` and
`cargo test --manifest-path src-tauri/Cargo.toml --lib`. Linux native tests need
the packages listed in `README.md`; report an environment blocker rather than
claiming success when they are absent.

Current frontend baseline: 25 test files, 154 tests, 71.13% statement coverage,
67.06% branch coverage, 79.95% function coverage, and 71.74% line coverage.
Update this file, `README.md`, and
`.github/instructions/testing.instructions.md` together whenever test counts or
coverage change. Update these instructions when architecture or invariants
change. `CLAUDE.md` is a compatibility pointer to this canonical guidance, not a
second source of truth.
