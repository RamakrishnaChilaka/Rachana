import { useEffect } from 'react'
import { useStore } from '../store/useStore'
import { getNativeApi, type MenuCommand } from '../lib/native'
import { isNamePromptOpen } from '../lib/namePrompt'
import {
  createDrawing,
  createMarkdownDocument,
  createWorkspaceFolder,
  selectWorkspace,
} from '../lib/workspaceActions'
import type {
  ExcalidrawImperativeAPI,
  NormalizedZoomValue,
} from '@excalidraw/excalidraw/types'

const editorAPIs = new Map<string, ExcalidrawImperativeAPI>()

export function registerEditorExcalidrawAPI(
  tabId: string,
  api: ExcalidrawImperativeAPI
) {
  editorAPIs.set(tabId, api)
  return () => {
    if (editorAPIs.get(tabId) === api) {
      editorAPIs.delete(tabId)
    }
  }
}

function getActiveExcalidrawAPI() {
  const activeTabId = useStore.getState().activeFile?.tabId
  return activeTabId ? editorAPIs.get(activeTabId) ?? null : null
}

export async function saveActiveTabAs(): Promise<void> {
  const state = useStore.getState()
  if (state.activeFile) {
    await state.saveTabAs(
      state.activeFile.path,
      undefined,
      state.activeFile.tabId
    )
  }
}

async function clearRecentDirectories() {
  const state = useStore.getState()
  const preferences = {
    ...state.preferences,
    recentDirectories: [],
  }
  await getNativeApi().preferences.save(preferences)
  useStore.getState().setPreferences(preferences)
}

function normalizeZoom(value: number): NormalizedZoomValue {
  return Math.min(Math.max(value, 0.1), 30) as NormalizedZoomValue
}

function zoomCanvas(factor: number) {
  const excalidrawAPI = getActiveExcalidrawAPI()
  if (!excalidrawAPI) return

  const appState = excalidrawAPI.getAppState()
  excalidrawAPI.updateScene({
    appState: {
      ...appState,
      zoom: {
        value: normalizeZoom(appState.zoom.value * factor),
      },
    },
  })
}

function resetCanvasZoom() {
  const excalidrawAPI = getActiveExcalidrawAPI()
  if (!excalidrawAPI) return

  const elements = excalidrawAPI.getSceneElements()
  if (elements && elements.length > 0) {
    excalidrawAPI.scrollToContent(elements, {
      fitToContent: true,
    })
    return
  }

  excalidrawAPI.updateScene({
    appState: {
      zoom: { value: normalizeZoom(1) },
      scrollX: 0,
      scrollY: 0,
    },
  })
}

async function toggleFullscreen() {
  const appWindow = getNativeApi().window
  await appWindow.setFullscreen(!(await appWindow.isFullscreen()))

  globalThis.setTimeout(() => {
    const excalidrawAPI = getActiveExcalidrawAPI()
    if (!excalidrawAPI) return
    try {
      excalidrawAPI.refresh()
      const elements = excalidrawAPI.getSceneElements()
      if (elements && elements.length > 0) {
        globalThis.setTimeout(() => {
          if (getActiveExcalidrawAPI() !== excalidrawAPI) return
          excalidrawAPI.scrollToContent(elements, {
            fitToContent: true,
          })
        }, 100)
      }
    } catch (error) {
      console.error('Failed to refresh the canvas after entering full screen:', error)
    }
  }, 300)
}

function showKeyboardShortcuts() {
  alert(`Keyboard Shortcuts

File
  Open folder: Cmd/Ctrl+O
  New drawing: Cmd/Ctrl+N
  New note: Cmd/Ctrl+Alt+N
  New folder: Cmd/Ctrl+Shift+N
  Save: Cmd/Ctrl+S
  Save As: Cmd/Ctrl+Shift+S
  Quit: Cmd/Ctrl+Q

View
  Toggle sidebar: Cmd/Ctrl+B
  Presentation mode: F5
  Full screen: F11
  Zoom in: Cmd/Ctrl++
  Zoom out: Cmd/Ctrl+-
  Reset zoom: Cmd/Ctrl+0

Editing shortcuts are handled directly by the active editor.`)
}

export async function executeMenuCommand({
  command,
  data,
}: MenuCommand): Promise<void> {
  if (isNamePromptOpen()) return

  const state = useStore.getState()
  switch (command) {
    case 'open_directory':
      await selectWorkspace()
      return
    case 'new_file':
      await createDrawing()
      return
    case 'new_note':
      await createMarkdownDocument()
      return
    case 'new_folder':
      await createWorkspaceFolder()
      return
    case 'save':
      await state.saveCurrentFile()
      return
    case 'save_as':
      await saveActiveTabAs()
      return
    case 'clear_recent':
      await clearRecentDirectories()
      return
    case 'toggle_sidebar':
      state.toggleSidebar()
      return
    case 'zoom_in':
      zoomCanvas(1.1)
      return
    case 'zoom_out':
      zoomCanvas(0.9)
      return
    case 'reset_zoom':
      resetCanvasZoom()
      return
    case 'fullscreen':
      await toggleFullscreen()
      return
    case 'minimize':
      await getNativeApi().window.minimize()
      return
    case 'close_window':
    case 'quit':
      await getNativeApi().window.close()
      return
    case 'keyboard_shortcuts':
      showKeyboardShortcuts()
      return
    default:
      if (/^recent_dir_\d+$/.test(command) && data?.directory) {
        await state.loadDirectory(data.directory)
        return
      }
      console.warn('Unknown menu command:', command)
  }
}

export function useMenuHandler() {
  useEffect(() => {
    const unlisten = getNativeApi().events.onMenuCommand((command) => {
      void executeMenuCommand(command)
    })

    return unlisten
  }, [])
}
