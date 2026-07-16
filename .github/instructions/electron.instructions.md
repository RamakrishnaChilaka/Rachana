---
applyTo: "{electron,build}/**/*.{ts,js,mjs,yml,yaml,plist}"
description: "Electron main/preload, IPC, filesystem safety, window lifecycle, security, menus, preferences, and packaging resources."
---

# Electron Instructions

- Main owns filesystem access, dialogs, preferences, native menus, window state,
  watching, and application shutdown. Preload exposes only named domain methods.
- Keep `contextIsolation`, `sandbox`, and `webSecurity` enabled. Keep Node
  integration, worker Node integration, and webview tags disabled.
- Never expose `ipcRenderer`, generic send/invoke methods, Node APIs, or Electron
  objects to the renderer.
- Validate every IPC sender, main-frame URL, and payload at the main boundary.
  New payloads require explicit schemas.
- Keep renderer navigation locked to the exact app document. Deny unexpected
  navigation, new windows, and permissions.
- Preserve kind-aware `.excalidraw`/Markdown path and content validation,
  expected hash and identity
  checks, per-path serialization, durable same-directory staging, in-place
  permission preservation, no-clobber Save As, rollback, and deletion scope.
- Watch only the active workspace, do not follow symlinks during tree traversal,
  and emit only supported document changes.
- Save As and rename must preserve document kind. Excalidraw JSON validation
  must never be applied to Markdown text, and Markdown must never bypass the
  shared durable-write path.
- Main initiates close; renderer resolves every affected unsaved tab and then
  explicitly approves or vetoes through `CloseCoordinator`.
- Preferences are normalized and atomically replaced in Electron `userData`.
  Rebuild native recent-directory menus only after persistence succeeds.
- Keep native and renderer menu command names and shortcuts aligned. Renderer
  disabled states are presentation safeguards; command handlers must remain
  safe when invoked from native menus or keyboard accelerators.
- Keep Electron entry, preload, renderer, icons, entitlements, and ASAR paths in
  sync with `electron.vite.config.ts` and `electron-builder.yml`.
