---
applyTo: "{scripts,.github/workflows,electron-builder.yml,package.json,package-lock.json}/**"
description: "Electron packaging, versioning, signing, notarization, App Store, GitHub releases, and artifact upload."
---

# Release Instructions

- Never push, tag, publish, upload, sign, notarize, or create a release without
  explicit user approval.
- Never print certificates, passwords, API private keys, provisioning profiles,
  or decoded secret material.
- Keep `package.json` and `package-lock.json` versions synchronized. Electron
  Builder is the release version source.
- Validate before packaging. Fail on missing, duplicate, or unexpected artifacts.
- Keep Developer ID DMG distribution and Mac App Store packaging separate. Do
  not mix identities, entitlements, profiles, keychains, or outputs.
- Release workflows use Node 26, Electron Builder, and committed build resources.
  They do not install Rust or platform webview SDKs.
- Preserve x64/ARM64 architecture checks and explicit artifact labels. Generate
  adjacent SHA-256 files for downloadable assets.
- Treat `/out`, `/release`, coverage, Playwright output, temporary keychains,
  decoded keys, and provisioning profiles as generated artifacts, never source.
- `v*` tags trigger the GitHub release workflow. The App Store workflow remains
  a separate manually dispatched operation.
