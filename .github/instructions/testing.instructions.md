---
applyTo: "src/**/*.{ts,tsx}"
description: "Use when changing frontend behavior, Excalidraw lifecycle, persistence, performance, tests, or coverage."
---

# Frontend Testing Instructions

- Add focused unit or integration coverage for every behavior change.
- Use the shared Tauri mocks in `src/test/setup.ts`; reset mutable mock state in
  `beforeEach`. Do not duplicate module mocks across files without a behavior
  reason.
- Prefer public behavior and resulting store state over implementation details.
  Use direct store calls only when testing the store action itself.
- For editor performance changes, test the number and timing of scene
  serializations rather than relying only on React render counts.
- Cover initial scene restoration, viewport-only callbacks, idle buffering,
  save-boundary flushing, stale `sceneVersion` rejection, and flusher cleanup
  when those paths change.
- For async store changes, include a race where state changes while an IPC call,
  confirmation, or write is pending. Verify both disk-baseline advancement and
  preservation of newer unsaved content.
- For file-watcher changes, test burst coalescing, an event arriving during an
  in-flight refresh, and stale directory results.
- When using fake timers, restore real timers in `afterEach` so later tests are
  isolated.
- Run the narrowest affected Vitest file immediately after an edit, then run
  `npm run typecheck`, `npm run test:run`, `npm run test:coverage`, and
  `npm run build` before completion.
- Live-test the production bundle with a non-empty Excalidraw scene. Do not claim
  native WSL/Tauri rendering is fully verified unless that exact webview workflow
  was reproduced.

Current baseline: 25 test files, 154 tests, 71.13% statement coverage, 67.06%
branch coverage, 79.95% function coverage, and 71.74% line coverage.
