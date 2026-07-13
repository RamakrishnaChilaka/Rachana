import { useRef, type KeyboardEvent } from 'react'
import { Plus, X } from 'lucide-react'
import { useStore } from '../store/useStore'
import { cn } from '../lib/utils'
import { drawingDisplayName } from '../lib/path'
import { getActiveDocumentSaveStatus } from '../lib/saveStatus'
import { createDrawing } from '../lib/workspaceActions'

export function TabBar() {
  const openTabs = useStore((state) => state.openTabs)
  const activeFile = useStore((state) => state.activeFile)
  const loadFile = useStore((state) => state.loadFile)
  const closeTab = useStore((state) => state.closeTab)
  const presentationMode = useStore((state) => state.presentationMode)
  const isDirty = useStore((state) => state.isDirty)
  const saveOperations = useStore((state) => state.saveOperations)
  const tabRefs = useRef(new Map<string, HTMLButtonElement>())

  const saveStatus = getActiveDocumentSaveStatus(
    activeFile,
    openTabs,
    isDirty,
    saveOperations
  )

  const moveToTab = (index: number) => {
    const tab = openTabs[index]
    tabRefs.current.get(tab.tabId)?.focus()
    void loadFile(tab)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % openTabs.length
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + openTabs.length) % openTabs.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = openTabs.length - 1

    if (nextIndex !== null) {
      event.preventDefault()
      moveToTab(nextIndex)
    }
  }

  return (
    <div
      className={cn('tab-region', presentationMode && 'presentation')}
    >
      <div
        className="tab-bar custom-scrollbar"
        role="tablist"
        aria-label="Open documents"
      >
        {openTabs.map((tab, index) => {
          const isActive = activeFile?.tabId
            ? activeFile.tabId === tab.tabId
            : activeFile?.path === tab.path
          const name = drawingDisplayName(tab.name)
          const isRecoveryCopy = tab.recoveryState === 'deleted-on-disk'
          const hasExternalConflict = tab.externalConflict === 'modified-on-disk'

          return (
            <div className={cn('tab-item', isActive && 'active')} key={tab.tabId}>
              <button
                ref={(element) => {
                  if (element) tabRefs.current.set(tab.tabId, element)
                  else tabRefs.current.delete(tab.tabId)
                }}
                className="tab-select"
                role="tab"
                aria-selected={isActive}
                aria-label={`${name}${hasExternalConflict ? ', changed on disk; save a copy' : tab.modified ? ', unsaved changes' : ''}${isRecoveryCopy ? ', recovery copy' : ''}`}
                tabIndex={isActive || (!activeFile && index === 0) ? 0 : -1}
                title={isRecoveryCopy
                  ? `${tab.name} — deleted on disk; use Save As to recover`
                  : hasExternalConflict
                    ? `${tab.name} — changed on disk; use Save As to keep local changes`
                  : tab.name}
                onClick={() => void loadFile(tab)}
                onKeyDown={(event) => handleKeyDown(event, index)}
              >
                <span className="tab-label">{name}</span>
                {tab.modified && (
                  <span className="modified-dot" aria-hidden="true" />
                )}
              </button>
              {!presentationMode && (
                <button
                  className="tab-close"
                  onClick={() => void closeTab(tab.path, tab.tabId)}
                  title={`Close ${name}`}
                  aria-label={`Close ${name}`}
                >
                  <X aria-hidden="true" />
                </button>
              )}
            </div>
          )
        })}
      </div>
      {!presentationMode && (
        <button
          className="new-tab-button"
          aria-label="New drawing"
          title="New drawing (Ctrl+N)"
          onClick={() => void createDrawing()}
        >
          <Plus aria-hidden="true" />
        </button>
      )}
      <div className="window-drag-region" data-electron-drag-region />
      {saveStatus && (
        <div
          className="tab-save-status"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          aria-label="Document save status"
        >
          {saveStatus}
        </div>
      )}
    </div>
  )
}
