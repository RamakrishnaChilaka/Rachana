---
applyTo: "{scripts,.github/workflows}/**"
description: "Use when changing release workflows, packaging, signing, notarization, App Store preparation, or artifact upload scripts."
---

# Release And Packaging Instructions

- Never run upload, publish, release, signing, notarization, `git push`, or PR
  creation commands without explicit user approval.
- Never print certificates, API keys, passwords, provisioning profiles, or
  decoded secret material. Secret prompts must be entered directly by the user.
- Keep version values synchronized across `package.json`, base Tauri config, and
  platform/App Store configs when a release explicitly changes version.
- Preserve the distinction between Developer ID distribution and Mac App Store
  packaging. Do not mix their entitlements, identities, profiles, or bundles.
- Keep workflows reproducible: validate first, pin action/tool versions, fail on
  missing artifacts, and do not weaken signing/notarization checks to get a
  green run.
- Treat generated bundles and temporary keychains/profiles as artifacts, not
  source files. Clean them without deleting user-owned credentials.