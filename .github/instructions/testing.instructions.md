---
applyTo: "{src,electron}/**/*.{ts,tsx}"
description: "Unit, integration, race, coverage, Electron smoke, and packaging validation."
---

# Testing Instructions

- Add focused tests for every behavior change. Race-sensitive persistence work
  requires stale/concurrent coverage, not only a happy path.
- Renderer tests use the shared typed bridge mocks in `src/test/setup.ts`.
  Main-process service tests use the Node Vitest environment.
- Test externally observable behavior and resulting store or disk state. Keep
  unsafe casts at synthetic test boundaries.
- Preserve coverage for restoration baselines, viewport-only callbacks, scene
  buffering, synchronous flushes, stale scene rejection, unsaved lifecycle,
  save races, Save As claims, external reconciliation, Markdown text buffering,
  kind-preserving native operations, watcher bursts, stale
  tree results, menu dispatch and disabled states, IPC security, and close
  vetoes.
- Restore real timers after fake-timer tests.
- Run the narrowest affected test immediately after each edit checkpoint.
- Before completion run, in order:
  1. `npm run typecheck`
  2. `npm run test:run`
  3. `npm run test:coverage`
  4. `npm run build`
  5. `npm run test:electron`
  6. `npm run package`
- The Playwright Electron test must launch bundled Chromium through Electron,
  verify preload availability, edit and save both a drawing and Markdown note,
  verify safe GFM preview, exercise document-aware menu states, check compact
  menu geometry after animations settle, verify generic creation controls expose
  drawing and Markdown choices, and inspect resulting files on disk. Packaging
  validation must also run against the packaged binary.

Current baseline: 31 Vitest files, 190 tests, 71.38% statement coverage, 65.96%
branch coverage, 79.96% function coverage, and 72.29% line coverage, plus one
Playwright Electron workflow.
