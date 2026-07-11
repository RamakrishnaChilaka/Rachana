# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Rachana is a Tauri-based, local-first desktop workspace for managing and editing visual canvases, with future support planned for Markdown, notes, and documents. The app provides a file browser sidebar and integrates the Excalidraw editor for a native desktop experience.

## Essential Commands

### Development
```bash
# Start development server (frontend + Tauri)
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Run Tauri-specific commands
npm run tauri dev    # Development mode with hot reload
npm run tauri build  # Build native app for current platform
npm run tauri icon   # Generate app icons
```

### Testing & Validation
```bash
# Type checking
npx tsc --noEmit

# Currently no test suite configured - tests need to be added
```

## Architecture Overview

### Technology Stack
- **Desktop Framework**: Tauri 2.x (Rust backend + Web frontend)
- **Frontend**: React 19.x + TypeScript 5.8
- **Build Tool**: Vite 7.x
- **Required SDK**: Excalidraw (not yet installed)
- **Styling**: TailwindCSS + shadcn/ui (planned, not yet installed)

### Project Structure
```
src/                    # React frontend application
├── App.tsx            # Main application component (needs implementation)
├── main.tsx           # React entry point
└── components/        # UI components (to be created)
    ├── Sidebar/       # File browser sidebar
    └── Editor/        # Excalidraw editor wrapper

src-tauri/             # Rust backend
├── src/
│   ├── main.rs       # Tauri application entry
│   └── lib.rs        # Core business logic
└── tauri.conf.json   # Tauri configuration
```

### Core Architecture Patterns

1. **File Management Architecture**
   - Rust backend handles all file system operations via Tauri commands
   - Frontend requests file operations through Tauri IPC
   - Directory state persisted in Tauri's app data directory
   - File watching implemented in Rust for real-time updates

2. **State Management Pattern**
   - Current directory path stored in React state and Tauri store
   - Active file tracked in React state
   - Unsaved changes tracked per file
   - Auto-save timer managed in React with debouncing

3. **IPC Communication**
   - Commands: `select_directory`, `list_files`, `read_file`, `save_file`
   - Events: `file_changed`, `directory_changed`, `save_complete`
   - All file paths use absolute paths for consistency

## Critical Implementation Notes

### Excalidraw Integration
The Excalidraw SDK needs to be installed and integrated:
```bash
npm install @excalidraw/excalidraw
```

Key integration points:
- Excalidraw component should be lazy-loaded for performance
- File data must be in Excalidraw's JSON format
- Handle binary data (images) embedded in drawings
- Implement onChange handler for auto-save trigger

### Tauri File Operations
All file operations must go through Tauri commands for security:
```rust
// src-tauri/src/main.rs or lib.rs
#[tauri::command]
async fn select_directory() -> Result<String, String> { }

#[tauri::command]
async fn list_excalidraw_files(dir: String) -> Result<Vec<String>, String> { }

#[tauri::command]
async fn read_excalidraw_file(path: String) -> Result<String, String> { }

#[tauri::command]
async fn save_excalidraw_file(path: String, content: String) -> Result<(), String> { }
```

### Window Configuration
Current window size (800x600) needs updating to match spec (1600x900 minimum):
```json
// src-tauri/tauri.conf.json
"window": {
  "width": 1600,
  "height": 900,
  "minWidth": 1600,
  "minHeight": 900
}
```

### Auto-Save Implementation
- Debounce saves to prevent excessive disk writes
- Save on file switch (immediate)
- Save on timer (30 seconds)
- Save on window close/app quit
- Track dirty state per file

## Product Requirements

Key requirements from `specs/0001-spec.md`:
- **No user registration** - completely local, free application
- **Simple file management** - browse and edit .excalidraw files
- **Auto-save** - prevent data loss with automatic saving
- **Fast switching** - quick navigation between files
- **Theme support** - light/dark/system themes

Performance targets:
- Startup time: <1 second
- File load: <500ms
- Auto-save: <100ms
- Memory: <200MB idle

## Current Development Status

### Completed
- Basic Tauri + React setup
- Project specifications (PRD)
- Directory structure

### TODO (Priority Order)
1. Install Excalidraw SDK and UI dependencies
2. Implement Tauri file system commands
3. Create Sidebar component for file listing
4. Integrate Excalidraw editor
5. Implement file switching logic
6. Add auto-save functionality
7. Configure proper window size
8. Add theme support
9. Implement keyboard shortcuts
10. Add error handling and user feedback

## Known Issues & Considerations

1. **Excalidraw Version Compatibility**: Lock Excalidraw version to prevent breaking changes
2. **Large File Handling**: Consider virtualization for directories with many files
3. **Binary Data**: Excalidraw files may contain embedded images (base64)
4. **File Watching**: Use Tauri's file system events for external changes
5. **Cross-Platform Paths**: Handle path differences between OS platforms