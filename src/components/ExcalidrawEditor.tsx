import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Excalidraw } from '@excalidraw/excalidraw'
import { useStore } from '../store/useStore'
import { setGlobalExcalidrawAPI } from '../hooks/useMenuHandler'
import { TIMING } from '../constants'
import type { OpenTab } from '../types'
import { FilePlus2, FolderOpen, LockKeyhole } from 'lucide-react'
import { createDrawing, selectWorkspace } from '../lib/workspaceActions'
import { didSceneElementsChange } from '../lib/sceneElements'

type ExcalidrawElement = any
type ExcalidrawAppState = any

interface EditorPaneProps {
  tab: OpenTab
  isActive: boolean
  presentationMode: boolean
  theme: 'light' | 'dark'
}

const EXCALIDRAW_UI_OPTIONS = {
  canvasActions: {
    loadScene: false,
    saveToActiveFile: false,
    saveAsImage: true,
    export: {
      saveFileToDisk: true,
    },
  },
}

const EditorPane = memo(function EditorPane({
  tab,
  isActive,
  presentationMode,
  theme,
}: EditorPaneProps) {
  const [isReady, setIsReady] = useState(false)
  const excalidrawAPIRef = useRef<any>(null)
  const initialLoadCompleteRef = useRef(false)
  const isUserChangeRef = useRef(false)
  const lastElementsRef = useRef(tab.cachedScene.elements || [])
  const hasCenteredInitialContentRef = useRef(false)
  const centerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const centerChangeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const initialData = useMemo(() => ({
    elements: tab.cachedScene.elements,
    appState: tab.cachedScene.appState,
    files: tab.cachedScene.files,
  }), [])

  const enableChangeTracking = useCallback(() => {
    initialLoadCompleteRef.current = true
    isUserChangeRef.current = true
    setIsReady(true)
  }, [])

  const clearCenterTimers = useCallback(() => {
    if (centerTimerRef.current) {
      clearTimeout(centerTimerRef.current)
      centerTimerRef.current = null
    }
    if (centerChangeTimerRef.current) {
      clearTimeout(centerChangeTimerRef.current)
      centerChangeTimerRef.current = null
    }
  }, [])

  const centerInitialContent = useCallback((api = excalidrawAPIRef.current) => {
    if (!isActive || !api || hasCenteredInitialContentRef.current) {
      return
    }

    const elements = tab.cachedScene.elements || []
    if (elements.length === 0) {
      hasCenteredInitialContentRef.current = true
      enableChangeTracking()
      return
    }

    hasCenteredInitialContentRef.current = true
    isUserChangeRef.current = false
    initialLoadCompleteRef.current = false
    clearCenterTimers()

    centerTimerRef.current = setTimeout(() => {
      api.scrollToContent(elements, {
        fitToContent: true,
      })
      api.refresh?.()

      centerChangeTimerRef.current = setTimeout(() => {
        centerChangeTimerRef.current = null
        enableChangeTracking()
      }, TIMING.USER_CHANGE_ENABLE_DELAY)
    }, TIMING.FILE_LOAD_DELAY)
  }, [
    clearCenterTimers,
    enableChangeTracking,
    isActive,
    tab.cachedScene.elements,
  ])

  useEffect(() => {
    centerInitialContent()
  }, [centerInitialContent])

  useEffect(() => {
    if (isActive && excalidrawAPIRef.current) {
      setGlobalExcalidrawAPI(excalidrawAPIRef.current)
    }
  }, [isActive])

  useEffect(() => {
    return () => {
      clearCenterTimers()
    }
  }, [clearCenterTimers])

  const handleChange = useCallback((
    elements: readonly ExcalidrawElement[],
    appState: ExcalidrawAppState,
    files: any
  ) => {
    if (!isActive || !isUserChangeRef.current || !initialLoadCompleteRef.current) {
      lastElementsRef.current = elements
      return
    }

    if (!didSceneElementsChange(lastElementsRef.current, elements)) {
      return
    }

    lastElementsRef.current = elements

    const store = useStore.getState()
    if (!store.isDirty) {
      store.setIsDirty(true)
      store.markFileAsModified(tab.path, true, tab.tabId)
      store.markTreeNodeAsModified(tab.path, true)
    }

    const newContent = JSON.stringify(
      {
        type: 'excalidraw',
        version: 2,
        source: 'Rachana',
        elements,
        appState: {
          gridSize: appState.gridSize,
          viewBackgroundColor: appState.viewBackgroundColor,
          currentItemFontFamily: appState.currentItemFontFamily,
          currentItemFontSize: appState.currentItemFontSize,
          currentItemStrokeColor: appState.currentItemStrokeColor,
          currentItemBackgroundColor: appState.currentItemBackgroundColor,
          currentItemFillStyle: appState.currentItemFillStyle,
          currentItemStrokeWidth: appState.currentItemStrokeWidth,
          currentItemRoughness: appState.currentItemRoughness,
          currentItemOpacity: appState.currentItemOpacity,
          currentItemTextAlign: appState.currentItemTextAlign,
        },
        files,
      },
      null,
      2
    )

    const freshStore = useStore.getState()
    if (freshStore.activeFile?.tabId === tab.tabId) {
      freshStore.setFileContent(newContent)
    }
  }, [isActive, tab.path, tab.tabId])

  return (
    <div
      className={`absolute inset-0 h-full ${isActive ? 'visible z-10' : 'invisible z-0 pointer-events-none'}`}
      aria-hidden={!isActive}
      role="tabpanel"
      aria-label={tab.name}
    >
      <Excalidraw
        initialData={initialData}
        excalidrawAPI={(api) => {
          excalidrawAPIRef.current = api
          if (isActive) {
            setGlobalExcalidrawAPI(api)
            centerInitialContent(api)
          }
        }}
        onChange={handleChange}
        theme={theme}
        viewModeEnabled={presentationMode}
        UIOptions={EXCALIDRAW_UI_OPTIONS}
      />
      {!isReady && isActive && (
        <div className="editor-loading absolute inset-0 z-20 flex items-center justify-center">
          <div className="flex items-center gap-3">
            <div className="editor-spinner h-5 w-5 animate-spin rounded-full border-2" />
            <span className="text-sm">Loading canvas...</span>
          </div>
        </div>
      )}
    </div>
  )
}, (previous, current) => (
  previous.tab.tabId === current.tab.tabId &&
  previous.tab.path === current.tab.path &&
  previous.tab.name === current.tab.name &&
  previous.tab.sceneVersion === current.tab.sceneVersion &&
  previous.isActive === current.isActive &&
  previous.presentationMode === current.presentationMode &&
  previous.theme === current.theme
))

interface ExcalidrawEditorProps {
  theme: 'light' | 'dark'
}

export function ExcalidrawEditor({ theme }: ExcalidrawEditorProps) {
  const activeFile = useStore(state => state.activeFile)
  const openTabs = useStore(state => state.openTabs)
  const presentationMode = useStore(state => state.presentationMode)
  const currentDirectory = useStore(state => state.currentDirectory)
  const fileTree = useStore(state => state.fileTree)

  if (!activeFile) {
    const hasWorkspace = Boolean(currentDirectory)
    const hasDrawings = fileTree.length > 0

    return (
      <main className="editor-region editor-empty">
        <div className="empty-state">
          <div className="empty-state-icon" aria-hidden="true">
            {hasWorkspace ? <FilePlus2 /> : <FolderOpen />}
          </div>
          <h1>
            {!hasWorkspace
              ? 'Open a folder to begin'
              : hasDrawings
                ? 'Choose a drawing'
                : 'Create your first drawing'}
          </h1>
          <p>
            {!hasWorkspace
              ? 'Use any local folder as your drawing workspace.'
              : hasDrawings
                ? 'Select a drawing in the workspace sidebar, or start a new one.'
                : 'This workspace is ready for its first Excalidraw file.'}
          </p>
          <div className="empty-state-actions">
            <button
              className="empty-primary-action"
              onClick={() => void (hasWorkspace ? createDrawing() : selectWorkspace())}
            >
              {hasWorkspace ? <FilePlus2 aria-hidden="true" /> : <FolderOpen aria-hidden="true" />}
              {hasWorkspace ? 'New drawing' : 'Open folder'}
            </button>
            <button
              className="empty-secondary-action"
              onClick={() => void (hasWorkspace ? selectWorkspace() : createDrawing())}
            >
              {hasWorkspace ? 'Open another folder' : 'Create a drawing'}
            </button>
          </div>
          <div className="local-reassurance">
            <LockKeyhole aria-hidden="true" />
            <span>Your files stay on this device.</span>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="editor-region">
      {openTabs.map((tab) => (
        <EditorPane
          key={`${tab.tabId}:${tab.sceneVersion}`}
          tab={tab}
          isActive={
            activeFile.tabId
              ? activeFile.tabId === tab.tabId
              : activeFile.path === tab.path
          }
          presentationMode={presentationMode}
          theme={theme}
        />
      ))}
    </main>
  )
}
