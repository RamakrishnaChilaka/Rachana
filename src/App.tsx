import { useEffect } from 'react'
import { Sidebar } from './components/Sidebar'
import { ExcalidrawEditor } from './components/ExcalidrawEditor'
import { LaserPointer } from './components/LaserPointer'
import { DocumentChrome, WindowResizeHandles } from './components/WindowChrome'
import { useStore } from './store/useStore'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { useMenuHandler } from './hooks/useMenuHandler'
import { useResolvedTheme } from './hooks/useResolvedTheme'
import { useAutoSave } from './hooks/useAutoSave'
import { useFileSystemChangeListener } from './hooks/useFileSystemChangeListener'
import { handleAppCloseRequest } from './lib/tabLifecycle'
import { getNativeApi } from './lib/native'

function App() {
  const loadPreferences = useStore((state) => state.loadPreferences)
  const currentDirectory = useStore((state) => state.currentDirectory)
  const sidebarVisible = useStore((state) => state.sidebarVisible)
  const presentationMode = useStore((state) => state.presentationMode)
  const theme = useResolvedTheme()

  // Load preferences and setup on mount
  useEffect(() => {
    loadPreferences()
  }, [loadPreferences])

  useFileSystemChangeListener(currentDirectory)

  // Listen for window close event
  useEffect(() => {
    const native = getNativeApi()
    const unlisten = native.events.onCheckUnsavedBeforeClose(async () => {
      const state = useStore.getState()
      let closeApproved = false
      try {
        closeApproved = await handleAppCloseRequest(
          state.openTabs,
          state.activeFile?.path ?? null,
          {
          getCurrentState: () => {
            const current = useStore.getState()
            return {
              openTabs: current.openTabs,
              activePath: current.activeFile?.path ?? null,
            }
          },
          confirmSave: () => native.dialogs.ask(
            'Do you want to save your changes before closing?',
            {
              title: 'Unsaved Changes',
              kind: 'warning',
              okLabel: 'Save & Close',
              cancelLabel: "Don't Save",
            }
          ),
          confirmDiscard: () => native.dialogs.ask(
            'Close without saving your changes?',
            {
              title: 'Confirm Close',
              kind: 'warning',
              okLabel: 'Close Without Saving',
              cancelLabel: 'Cancel',
            }
          ),
          saveActive: () => useStore.getState().saveCurrentFile(),
          notifyBlocked: async (unsavedCount) => {
            await native.dialogs.message(
              `${unsavedCount} drawing${unsavedCount === 1 ? ' has' : 's have'} unsaved or recovery changes. Save or close those tabs before quitting.`,
              {
                title: 'Unsaved Drawings',
                kind: 'warning',
              }
            )
          },
            forceClose: () => native.app.forceClose(),
          }
        )
      } finally {
        if (!closeApproved) {
          await native.app.cancelClose()
        }
      }
    })

    return () => {
      unlisten()
    }
  }, [])

  // Setup keyboard shortcuts
  useKeyboardShortcuts()
  useAutoSave()

  // Setup menu handler (NOTE: ExcalidrawEditor will set the Excalidraw API)
  useMenuHandler()

  return (
    <div className={`app-shell ${presentationMode ? 'cursor-none' : ''}`}>
      {sidebarVisible && !presentationMode && <Sidebar />}
      <section className="editor-column" aria-label="Drawing editor">
        <DocumentChrome />
        <ExcalidrawEditor theme={theme} />
      </section>
      {presentationMode && <LaserPointer />}
      <WindowResizeHandles />
    </div>
  )
}

export default App
