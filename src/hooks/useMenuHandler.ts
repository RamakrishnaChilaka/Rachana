import { useEffect } from 'react'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useStore } from '../store/useStore'
import { convertPreferencesToRust } from '../lib/preferences'
import { isNamePromptOpen } from '../lib/namePrompt'
import {
  createDrawing,
  createWorkspaceFolder,
  selectWorkspace,
} from '../lib/workspaceActions'
import type {
  ExcalidrawImperativeAPI,
  NormalizedZoomValue,
} from '@excalidraw/excalidraw/types'

export interface MenuCommand {
  command: string
  data?: {
    directory?: string
  }
}

let globalExcalidrawAPI: ExcalidrawImperativeAPI | null = null

export function setGlobalExcalidrawAPI(api: ExcalidrawImperativeAPI | null) {
  globalExcalidrawAPI = api
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
  await invoke('save_preferences', {
    preferences: convertPreferencesToRust(preferences),
  })
  useStore.getState().setPreferences(preferences)
}

function normalizeZoom(value: number): NormalizedZoomValue {
  return Math.min(Math.max(value, 0.1), 30) as NormalizedZoomValue
}

function zoomCanvas(factor: number) {
  if (!globalExcalidrawAPI) return

  const appState = globalExcalidrawAPI.getAppState()
  globalExcalidrawAPI.updateScene({
    appState: {
      ...appState,
      zoom: {
        value: normalizeZoom(appState.zoom.value * factor),
      },
    },
  })
}

function resetCanvasZoom() {
  if (!globalExcalidrawAPI) return

  const elements = globalExcalidrawAPI.getSceneElements()
  if (elements && elements.length > 0) {
    globalExcalidrawAPI.scrollToContent(elements, {
      fitToContent: true,
    })
    return
  }

  globalExcalidrawAPI.updateScene({
    appState: {
      zoom: { value: normalizeZoom(1) },
      scrollX: 0,
      scrollY: 0,
    },
  })
}

async function toggleFullscreen() {
  const appWindow = getCurrentWindow()
  await appWindow.setFullscreen(!(await appWindow.isFullscreen()))

  const excalidrawAPI = globalExcalidrawAPI
  if (!excalidrawAPI) return

  globalThis.setTimeout(() => {
    try {
      excalidrawAPI.refresh()
      const elements = excalidrawAPI.getSceneElements()
      if (elements && elements.length > 0) {
        globalThis.setTimeout(() => {
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
      await getCurrentWindow().minimize()
      return
    case 'close_window':
    case 'quit':
      await getCurrentWindow().close()
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
    let unlisten: UnlistenFn | null = null

    void listen<MenuCommand>('menu-command', (event) => {
      void executeMenuCommand(event.payload)
    }).then((cleanup) => {
      unlisten = cleanup
    })

    return () => {
      unlisten?.()
    }
  }, [])
}
