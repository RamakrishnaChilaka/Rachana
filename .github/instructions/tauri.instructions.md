---
applyTo: "src-tauri/**/*.{rs,toml,json}"
description: "Use when changing Tauri commands, Rust filesystem behavior, security validation, file watching, native menus, windows, or preferences."
---

# Tauri And Rust Instructions

## Ownership And Security

- All filesystem operations cross registered Tauri commands. Validate paths and
  `.excalidraw` file constraints through `security.rs` before reading or writing.
- Keep saves atomic and conflict-aware. Preserve expected content hashes, file
  identity checks, same-file detection, and write serialization.
- Keep command argument names synchronized with frontend `invoke()` payloads.
  Search both Rust registration and every TypeScript caller before renaming or
  removing a command.
- File/folder deletion must compute scope against every open tab and retain
  frontend recovery semantics. Do not reduce it to an unconditional remove.
- Watcher events can race with app-originated saves. Preserve watcher retention,
  event filtering, and serialized frontend reconciliation.
- Never weaken the CSP, capability allowlist, path traversal checks, symlink
  handling, or file-type validation merely to make a command convenient.

## Native State And Platform Behavior

- `AppState` contains shared native coordination state. Keep lock scope short and
  never hold a synchronous lock across an `.await` or user interaction.
- Native menus are defined in `menu.rs`; frontend handling is in
  `useMenuHandler.ts`. Update both sides of a menu command contract together.
- Linux and macOS window decoration/titlebar behavior differs by Tauri config.
  Check base and platform-specific configs before changing window chrome.
- Preference schema changes require synchronized Rust structs, TypeScript
  conversion helpers, defaults, migration behavior, and tests.

## Validation

- Run `cargo fmt --manifest-path src-tauri/Cargo.toml` after every Rust edit.
- Run `cargo test --manifest-path src-tauri/Cargo.toml --lib` for native changes.
- Also run frontend typecheck/tests when a command payload or emitted event
  changes.
- Linux builds require `pkg-config`, DBus, GTK, and WebKit development packages
  listed in `README.md`. Distinguish missing system dependencies from code
  failures in reports.