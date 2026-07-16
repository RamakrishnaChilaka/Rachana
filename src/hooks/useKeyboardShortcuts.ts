import { useEffect } from 'react'
import { useStore } from '../store/useStore'
import { isNamePromptOpen, promptForName } from '../lib/namePrompt'
import { getNativeApi } from '../lib/native'
import { executeMenuCommand, saveActiveTabAs } from './useMenuHandler'
import { createMarkdownDocument } from '../lib/workspaceActions'

export function useKeyboardShortcuts() {
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (isNamePromptOpen()) {
        return
      }

      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
      const modKey = isMac ? e.metaKey : e.ctrlKey
      const state = useStore.getState()

      // Don't handle any events if clipboard operations are being used
      // Let Excalidraw handle all clipboard operations natively
      if (modKey && (e.key === 'c' || e.key === 'v' || e.key === 'x' || e.key === 'a')) {
        return
      }

      // F5: Toggle presentation mode
      if (e.key === 'F5') {
        e.preventDefault()
        state.togglePresentationMode()
      }

      // Escape: Exit presentation mode
      if (e.key === 'Escape') {
        if (state.presentationMode) {
          e.preventDefault()
          state.togglePresentationMode()
        }
      }

      if (e.key === 'F11') {
        e.preventDefault()
        await executeMenuCommand({ command: 'fullscreen' })
      }

      // Cmd/Ctrl + B: Toggle sidebar
      if (modKey && e.key === 'b') {
        e.preventDefault()
        state.toggleSidebar()
      }

      // Cmd/Ctrl + Shift + S: Save current file under a new name
      if (modKey && e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault()
        await saveActiveTabAs()
      } else if (modKey && e.key.toLowerCase() === 's') {
        e.preventDefault()
        await state.saveCurrentFile()
      }

      // Cmd/Ctrl + O: Open directory
      if (modKey && e.key === 'o') {
        e.preventDefault()
        const dir = await getNativeApi().workspace.selectDirectory()
        if (dir) {
          await state.loadDirectory(dir)
        }
      }

      // Cmd/Ctrl + Shift + N: New folder
      if (modKey && e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault()

        // If no directory is selected, select one first
        if (!state.currentDirectory) {
          const dir = await getNativeApi().workspace.selectDirectory()
          if (dir) {
            await state.loadDirectory(dir)
          } else {
            return
          }
        }

        const folderName = await promptForName({
          title: 'Folder name',
          defaultValue: 'New Folder',
          confirmLabel: 'Create',
        })
        if (!folderName) {
          return
        }

        await state.createNewFolder(folderName)
      }

      // Cmd/Ctrl + Alt + N: New Markdown note
      if (modKey && e.altKey && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        await createMarkdownDocument()
      }

      // Cmd/Ctrl + N: New file
      if (modKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'n') {
        e.preventDefault()

        // If no directory is selected, select one first
        if (!state.currentDirectory) {
          const dir = await getNativeApi().workspace.selectDirectory()
          if (dir) {
            await state.loadDirectory(dir)
          } else {
            return
          }
        }

        const fileName = await promptForName({
          title: 'File name',
          defaultValue: 'Untitled.excalidraw',
          confirmLabel: 'Create',
        })
        if (!fileName) {
          return
        }

        await state.createNewFile(fileName)
      }

      // Cmd/Ctrl + W: Close current tab
      if (modKey && e.key === 'w') {
        e.preventDefault()
        if (state.activeFile) {
          await state.closeTab(state.activeFile.path, state.activeFile.tabId)
        }
      }

      if (modKey && e.key.toLowerCase() === 'q') {
        e.preventDefault()
        await executeMenuCommand({ command: 'quit' })
      }

      if (modKey && e.key.toLowerCase() === 'm') {
        e.preventDefault()
        await executeMenuCommand({ command: 'minimize' })
      }

      // Cmd/Ctrl + Tab / Cmd/Ctrl + Shift + Tab: Switch tabs
      if (modKey && e.key === 'Tab') {
        e.preventDefault()
        if (state.openTabs.length > 1 && state.activeFile) {
          const currentIndex = state.openTabs.findIndex((tab) =>
            state.activeFile?.tabId
              ? tab.tabId === state.activeFile.tabId
              : tab.path === state.activeFile?.path
          )
          if (e.shiftKey) {
            const prevIndex = currentIndex === 0
              ? state.openTabs.length - 1
              : currentIndex - 1
            await state.loadFile(state.openTabs[prevIndex])
          } else {
            const nextIndex = (currentIndex + 1) % state.openTabs.length
            await state.loadFile(state.openTabs[nextIndex])
          }
        }
      }
    }

    // Use non-capturing phase to let Excalidraw handle events first
    window.addEventListener('keydown', handleKeyDown, false)
    return () => window.removeEventListener('keydown', handleKeyDown, false)
  }, [])
}
