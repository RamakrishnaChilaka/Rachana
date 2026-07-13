# CLAUDE.md

Use `.github/copilot-instructions.md` as the canonical repository guidance and
load the matching file from `.github/instructions/` for frontend, Electron,
testing, or release work. These instructions apply regardless of model vendor.

Rachana is an implemented local-first Electron 43 application for ordinary
`.excalidraw` files. Electron main owns native behavior; the sandboxed renderer
uses only the typed `window.rachana` preload bridge. Preserve tab identity,
conflict/recovery state, durable writes, hashes, file identity, scene buffering,
and shutdown vetoes.

Before completion run:

```bash
npm run typecheck
npm run test:run
npm run test:coverage
npm run build
npm run test:electron
npm run package
```

Do not push, tag, publish, upload, sign, notarize, or create a release without
explicit user approval.
