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
  save races, Save As claims, external reconciliation, watcher bursts, stale
  tree results, IPC security, and close vetoes.
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
  verify preload availability, edit a drawing, save it, and inspect the resulting
  JSON on disk. Packaging validation must also run against the packaged binary.

Current baseline: 28 Vitest files, 161 tests, 70.54% statement coverage, 65.61%
branch coverage, 78.75% function coverage, and 71.39% line coverage, plus one
Playwright Electron workflow.
