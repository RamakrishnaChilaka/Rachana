---
applyTo: "src/**/*.{ts,tsx,css}"
description: "Use when changing React UI, Zustand state, Excalidraw lifecycle, tabs, menus, preferences, or frontend styling."
---

# Frontend Architecture Instructions

## State And Lifecycle

- `useStore.ts` is a coordinator, not a generic bag of setters. Expose named
  actions that preserve invariants instead of adding raw state setters.
- Capture a snapshot before asynchronous work, then call `get()` again and
  compare `tabId`, content, hashes, identity, scene/lifecycle versions, and
  conflict state before committing results.
- Use `pathsEqual()` or normalized path keys for cross-platform comparisons.
  Use exact paths only where the native command contract requires them.
- Derive unsaved state through `isUnsavedTab()` and save labels through
  `getActiveDocumentSaveStatus()`; do not create competing booleans.
- Preferences are cached in Zustand but persisted by Tauri. A preference change
  is incomplete until `savePreferences()` succeeds or the failure is handled.

## Excalidraw

- Keep the runtime SDK lazy. `import type` from
  `@excalidraw/excalidraw/types` or `element/types`; dynamically import the
  component itself.
- Excalidraw elements are immutable. Detect scene changes by array length and
  element reference identity, as `didSceneElementsChange()` does.
- `initialData` is stable for one pane instance. A `sceneVersion` key remounts
  the pane when disk content must replace it.
- The first restored `onChange` establishes `lastElementsRef`; it is not a user
  edit. Viewport-only callbacks must remain no-ops for persistence.
- Buffer the latest elements/appState/files in refs. On idle, persist only the
  intentional app-state fields and update the exact `tabId` if its
  `sceneVersion` is still current.
- Global menu canvas commands must point at the active pane only. Do not keep a
  stale API after activation changes.

## UI And Styling

- Use existing Radix primitives and Lucide icons. Preserve keyboard navigation,
  focus-visible states, ARIA roles/labels, and native-window drag/resize regions.
- Keep sidebar width constants in `src/lib/layout.ts`; do not duplicate them in
  component or global constant modules.
- Keep platform detection in `src/lib/platform.ts`; CSS consumes
  `html[data-platform='linux'|'macos']` for text rendering and window chrome.
- Avoid broad Zustand subscriptions in components. Select only rendered state;
  use `useStore.getState()` inside high-frequency callbacks.