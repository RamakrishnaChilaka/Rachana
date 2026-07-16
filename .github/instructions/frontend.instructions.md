---
applyTo: "src/**/*.{ts,tsx,css}"
description: "React, Zustand, Excalidraw lifecycle, tabs, native bridge calls, and frontend styling."
---

# Frontend Instructions

- Renderer code is browser-only. Never import Node or Electron modules; call
  named methods on the typed `window.rachana` bridge.
- Keep `useStore.ts` as the coordinator for tabs, save transactions, conflicts,
  recovery, deletion, and workspace mutation. Do not add raw setters that bypass
  these invariants.
- Identify tabs by `tabId`, not path. After every `await`, re-read Zustand state
  and verify relevant content, hash, identity, `contentVersion`, and
  `lifecycleVersion` snapshots before applying results.
- Preserve unsaved semantics for `deleted-on-disk` and `modified-on-disk` tabs.
  Never silently overwrite their original paths.
- Keep Excalidraw runtime imports dynamic. Buffer `onChange` scenes in refs and
  keep full-scene serialization and Zustand writes out of pointer hot paths.
- Flush pending content before Save, Save As, workspace resolution, tab
  deactivation, and editor unmount. Reject stale `contentVersion` writes.
- Keep inactive editor panes mounted so undo history survives. Hide them with
  `display: none`, use view mode, and disable scroll detection; never wrap them
  in React `Activity`.
- Resolve canvas APIs by active `tabId` and use identity-safe cleanup so stale
  pane teardown cannot remove a newer registration.
- Keep Markdown as raw text in mounted CodeMirror instances. Buffer store writes,
  defer preview parsing, preserve undo history across tab switches, and never
  enable raw HTML in `react-markdown`.
- Keep the application menu grouped, keyboard-accessible, and capability-aware:
  Save requires an active document, canvas controls require Excalidraw, and
  recent entries retain enough path context to distinguish duplicate names.
- Route generic plus and New controls through the shared New document menu so
  both drawings and Markdown notes remain equally discoverable. Use explicit
  single-kind labels only when the control itself is intentionally specific.
- Size Radix portal menus from their available-height custom property so custom
  titlebar offsets and compact windows cannot clip commands.
- Preserve Radix, Lucide, accessibility, focus, custom titlebar, and platform CSS
  patterns already used in the application.
