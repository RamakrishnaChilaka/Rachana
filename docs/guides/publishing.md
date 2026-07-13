# Publishing Guide

This guide is for maintainers who publish Rachana builds.

## GitHub Release

Every pushed `v*` tag, such as `v0.2.0`, triggers `.github/workflows/release.yml`. Its distribution jobs remain skipped unless the repository variable `RACHANA_DISTRIBUTION_ENABLED` is explicitly set to `true`.

The workflow builds:

- Windows x86_64 NSIS (`.exe`) and MSI (`.msi`) installers
- Windows ARM64 NSIS (`.exe`) installer
- Linux x86_64 AppImage
- macOS Apple Silicon DMG when `RACHANA_MACOS_RELEASE_ENABLED` is also set to `true`

It then creates a GitHub Release and uploads the available assets.

Publish a GitHub Release:

```bash
git checkout main
git pull --ff-only origin main
git tag -a v0.2.0 -m "Release v0.2.0"
git push origin v0.2.0
```

Notes:

- Windows installers are unsigned and include adjacent SHA-256 checksum files.
  Microsoft Defender SmartScreen may warn until signed releases are configured.
- Windows builds run natively on `windows-2025` (x86_64) and `windows-11-arm`
  (ARM64), and fail before packaging if Node resolves to the wrong architecture.
- The ARM64 Electron application and packaged Chromium runtime are native ARM64.
- macOS builds require macOS 12 or newer and target Apple Silicon only.
- The macOS workflow produces an explicitly labeled unsigned DMG by default.
- Set `RACHANA_MACOS_SIGNED_RELEASE_ENABLED` to `true` only after all Apple signing and notarization secrets are configured. Signed releases use a Developer ID certificate and are notarized before upload.
- Keep `package-lock.json` committed for reproducible Electron release builds.
- If the release workflow changes after a tag is pushed, use a new tag or intentionally move the existing tag after verifying the impact.

Unsigned builds require no Apple credentials. Because macOS Gatekeeper blocks unidentified developers by default, users must Control-click Rachana in Finder, choose **Open**, then confirm **Open** on first launch.

Signed and notarized GitHub releases require:

```text
APPLE_SIGNING_IDENTITY
DEVELOPER_ID_APPLICATION_CERTIFICATE_BASE64
DEVELOPER_ID_APPLICATION_CERTIFICATE_PASSWORD
APPLE_API_KEY_ID
APPLE_API_ISSUER
APPLE_API_PRIVATE_KEY_BASE64
```

## Manual Mac App Store Release

The Mac App Store workflow is separate from GitHub Releases and only runs when manually triggered from GitHub Actions.
It uses the same `RACHANA_DISTRIBUTION_ENABLED` gate.

The workflow:

- builds the signed MAS `.pkg`
- uploads it to App Store Connect
- stores the package as a workflow artifact

Configure these repository secrets before running `.github/workflows/app-store-release.yml`:

```text
APPLE_TEAM_ID
APPLE_SIGNING_IDENTITY
APPLE_INSTALLER_SIGNING_IDENTITY
APPLE_CERTIFICATE_BASE64
APPLE_CERTIFICATE_PASSWORD
APPLE_INSTALLER_CERTIFICATE_BASE64
APPLE_INSTALLER_CERTIFICATE_PASSWORD
APPLE_API_KEY_ID
APPLE_API_ISSUER
APPLE_API_PRIVATE_KEY_BASE64
KEYCHAIN_PASSWORD
MAS_PROVISION_PROFILE_BASE64
```

Generate the base64 values locally:

```bash
base64 -i AppleDistribution.p12 | pbcopy
base64 -i AppleInstaller.p12 | pbcopy
base64 -i AuthKey_XXXXXXXXXX.p8 | pbcopy
base64 -i Rachana.provisionprofile | pbcopy
```

Run the workflow manually from GitHub Actions:

1. Open **Actions**.
2. Select **App Store Release**.
3. Click **Run workflow**.
4. Enter the version label, such as `v0.2.0`.

Notes:

- The Mac App Store build uses `electron-builder.yml`,
  `build/entitlements.mas.plist`, and
  `build/entitlements.mas.inherit.plist`. The provisioning profile is decoded
  into the GitHub runner's temporary directory and passed directly to Electron
  Builder.
- Signing certificates, private keys, and provisioning profiles are temporary
  workflow inputs and are never committed.
- The app is sandboxed and uses user-selected read/write access. If persistent access to the last opened folder after app restart is required, implement security-scoped bookmarks before relying on automatic folder restore in the store build.
