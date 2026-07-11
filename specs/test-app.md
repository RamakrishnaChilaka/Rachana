# Rachana Testing Checklist

## ✅ Fixed Issues
- [x] Sidebar now displays correctly on app startup
- [x] Default preferences set sidebar_visible to true
- [x] Removed conditional rendering that was hiding sidebar

## 🧪 Features to Test

### 1. Directory Management
- [ ] Click "Select Directory" button in sidebar
- [ ] Navigate to the `examples` folder in the project
- [ ] Verify files (api.excalidraw, assistant.excalidraw) appear in sidebar
- [ ] Check that directory is remembered on app restart

### 2. File Operations
- [ ] Click on a file in sidebar to load it
- [ ] Verify Excalidraw editor loads with file content
- [ ] Edit the drawing (add shapes, text, etc.)
- [ ] Verify file shows modified indicator (orange dot)
- [ ] Switch to another file and verify auto-save
- [ ] Press Cmd+S to manually save

### 3. New File Creation
- [ ] Click "New File" button
- [ ] Enter a file name when prompted
- [ ] Verify new file appears in sidebar
- [ ] Verify new file opens in editor

### 4. Keyboard Shortcuts
- [ ] Cmd+O: Opens directory selector
- [ ] Cmd+S: Saves current file
- [ ] Cmd+N: Creates new file
- [ ] Cmd+B: Toggles sidebar visibility
- [ ] Cmd+Tab: Switch to next file
- [ ] Cmd+Shift+Tab: Switch to previous file

### 5. Auto-Save
- [ ] Make changes to a file
- [ ] Wait 30 seconds
- [ ] Verify file is automatically saved
- [ ] Check that modified indicator disappears

### 6. UI/UX
- [ ] Sidebar width is 280px as designed
- [ ] File items have proper hover effects
- [ ] Active file is highlighted in blue
- [ ] Modified files show orange dot indicator
- [ ] Window minimum size is 1200x700

## 📝 Notes
- The app uses Tauri for native file system access
- Preferences are stored in `~/Library/Application Support/io.github.ramakrishnachilaka.rachana/`.
- Auto-save triggers after 1 second of inactivity (debounced)
- Full auto-save runs every 30 seconds for safety