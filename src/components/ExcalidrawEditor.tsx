import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useStore } from '../store/useStore'
import { registerEditorExcalidrawAPI } from '../hooks/useMenuHandler'
import { TIMING } from '../constants'
import type { ExcalidrawOpenTab } from '../types'
import { FilePlus2, FolderOpen, LockKeyhole } from 'lucide-react'
import {
  createDrawing,
  createMarkdownDocument,
  selectWorkspace,
} from '../lib/workspaceActions'
import { didSceneElementsChange } from '../lib/sceneElements'
import {
  registerEditorContentFlusher,
} from '../lib/editorContentSync'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type {
  AppState as ExcalidrawAppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
} from '@excalidraw/excalidraw/types'

const Excalidraw = lazy(async () => {
  const module = await import('@excalidraw/excalidraw')
  return { default: module.Excalidraw }
})

interface PendingScene {
  elements: readonly ExcalidrawElement[]
  appState: ExcalidrawAppState
  files: BinaryFiles
}

interface EditorPaneProps {
  tab: ExcalidrawOpenTab
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
  const excalidrawAPIRef = useRef<ExcalidrawImperativeAPI | null>(null)
  const menuAPIRef = useRef<ExcalidrawImperativeAPI | null>(null)
  const unregisterMenuAPIRef = useRef<(() => void) | null>(null)
  const initialLoadCompleteRef = useRef(false)
  const hasObservedInitialSceneRef = useRef(false)
  const isUserChangeRef = useRef(false)
  const lastElementsRef = useRef(tab.cachedScene.elements || [])
  const hasCenteredInitialContentRef = useRef(false)
  const centerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const contentSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingSceneRef = useRef<PendingScene | null>(null)

  // The contentVersion key remounts this pane; initialData stays stable until then.
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
  }, [])

  const disconnectMenuAPI = useCallback(() => {
    unregisterMenuAPIRef.current?.()
    unregisterMenuAPIRef.current = null
    menuAPIRef.current = null
  }, [])

  const connectMenuAPI = useCallback((api: ExcalidrawImperativeAPI) => {
    if (menuAPIRef.current === api) return
    disconnectMenuAPI()
    menuAPIRef.current = api
    unregisterMenuAPIRef.current = registerEditorExcalidrawAPI(tab.tabId, api)
  }, [disconnectMenuAPI, tab.tabId])

  const flushPendingScene = useCallback(() => {
    if (contentSyncTimerRef.current) {
      clearTimeout(contentSyncTimerRef.current)
      contentSyncTimerRef.current = null
    }

    const pendingScene = pendingSceneRef.current
    if (!pendingScene) {
      return
    }
    pendingSceneRef.current = null

    const persistedAppState = {
      gridSize: pendingScene.appState.gridSize,
      viewBackgroundColor: pendingScene.appState.viewBackgroundColor,
      currentItemFontFamily: pendingScene.appState.currentItemFontFamily,
      currentItemFontSize: pendingScene.appState.currentItemFontSize,
      currentItemStrokeColor: pendingScene.appState.currentItemStrokeColor,
      currentItemBackgroundColor: pendingScene.appState.currentItemBackgroundColor,
      currentItemFillStyle: pendingScene.appState.currentItemFillStyle,
      currentItemStrokeWidth: pendingScene.appState.currentItemStrokeWidth,
      currentItemRoughness: pendingScene.appState.currentItemRoughness,
      currentItemOpacity: pendingScene.appState.currentItemOpacity,
      currentItemTextAlign: pendingScene.appState.currentItemTextAlign,
    }
    const scene = {
      elements: pendingScene.elements,
      appState: persistedAppState,
      files: pendingScene.files,
    }
    const content = JSON.stringify(
      {
        type: 'excalidraw',
        version: 2,
        source: 'Rachana',
        ...scene,
      },
      null,
      2
    )

    useStore.getState().updateTabContent(
      tab.tabId,
      tab.contentVersion,
      content,
      scene
    )
  }, [tab.contentVersion, tab.tabId])

  const scheduleContentSync = useCallback(() => {
    if (contentSyncTimerRef.current) {
      clearTimeout(contentSyncTimerRef.current)
    }
    contentSyncTimerRef.current = setTimeout(
      flushPendingScene,
      TIMING.SCENE_SYNC_DELAY
    )
  }, [flushPendingScene])

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
      centerTimerRef.current = null
      try {
        api.scrollToContent(elements, {
          fitToContent: true,
        })
        api.refresh?.()
      } finally {
        if (hasObservedInitialSceneRef.current) {
          enableChangeTracking()
        }
      }
    }, 0)
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
    if (!isActive) return
    if (excalidrawAPIRef.current) {
      connectMenuAPI(excalidrawAPIRef.current)
    }
    return disconnectMenuAPI
  }, [connectMenuAPI, disconnectMenuAPI, isActive])

  useEffect(() => {
    if (!isActive) {
      flushPendingScene()
    }
  }, [flushPendingScene, isActive])

  useEffect(() => {
    const unregister = registerEditorContentFlusher(tab.tabId, flushPendingScene)
    return () => {
      flushPendingScene()
      unregister()
    }
  }, [flushPendingScene, tab.tabId])

  useEffect(() => {
    return () => {
      clearCenterTimers()
    }
  }, [clearCenterTimers])

  const handleChange = useCallback((
    elements: readonly ExcalidrawElement[],
    appState: ExcalidrawAppState,
    files: BinaryFiles
  ) => {
    if (!initialLoadCompleteRef.current) {
      lastElementsRef.current = elements
      hasObservedInitialSceneRef.current = true
      if (isActive && hasCenteredInitialContentRef.current) {
        enableChangeTracking()
      }
      return
    }

    if (!isActive || !isUserChangeRef.current) {
      lastElementsRef.current = elements
      return
    }

    if (!didSceneElementsChange(lastElementsRef.current, elements)) {
      return
    }

    lastElementsRef.current = elements

    pendingSceneRef.current = { elements, appState, files }
    scheduleContentSync()

    const store = useStore.getState()
    if (!store.isDirty) {
      store.setIsDirty(true)
      store.markFileAsModified(tab.path, true, tab.tabId)
      store.markTreeNodeAsModified(tab.path, true)
    }
  }, [enableChangeTracking, isActive, scheduleContentSync, tab.path, tab.tabId])

  return (
    <div
      className={`absolute inset-0 h-full ${isActive ? 'visible z-10' : 'hidden'}`}
      aria-hidden={!isActive}
      role="tabpanel"
      aria-label={tab.name}
    >
      <Suspense fallback={null}>
        <Excalidraw
          initialData={initialData}
          excalidrawAPI={(api) => {
            excalidrawAPIRef.current = api
            if (isActive) {
              connectMenuAPI(api)
              centerInitialContent(api)
            }
          }}
          onChange={handleChange}
          theme={theme}
          viewModeEnabled={presentationMode || !isActive}
          detectScroll={false}
          UIOptions={EXCALIDRAW_UI_OPTIONS}
        />
      </Suspense>
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
  previous.tab.contentVersion === current.tab.contentVersion &&
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
  const drawingTabs = openTabs.filter(
    (tab): tab is ExcalidrawOpenTab => tab.kind === 'excalidraw'
  )

  if (!activeFile) {
    const hasWorkspace = Boolean(currentDirectory)
    const hasDocuments = fileTree.length > 0

    return (
      <main className="editor-region editor-empty">
        <div className="empty-state">
          <div className="empty-state-icon" aria-hidden="true">
            {hasWorkspace ? <FilePlus2 /> : <FolderOpen />}
          </div>
          <h1>
            {!hasWorkspace
              ? 'Open a folder to begin'
              : hasDocuments
                ? 'Choose a document'
                : 'Create your first document'}
          </h1>
          <p>
            {!hasWorkspace
              ? 'Use any local folder as your drawing workspace.'
              : hasDocuments
                ? 'Select a drawing or note in the workspace sidebar.'
                : 'Start with an Excalidraw canvas or Markdown note.'}
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
              onClick={() => void (
                hasWorkspace ? createMarkdownDocument() : createDrawing()
              )}
            >
              {hasWorkspace ? 'New note' : 'Create a drawing'}
            </button>
            {hasWorkspace && (
              <button
                className="empty-secondary-action"
                onClick={() => void selectWorkspace()}
              >
                Open another folder
              </button>
            )}
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
      {drawingTabs.map((tab) => {
        const isActive = activeFile.tabId
          ? activeFile.tabId === tab.tabId
          : activeFile.path === tab.path

        return (
          <EditorPane
            key={`${tab.tabId}:${tab.contentVersion}`}
            tab={tab}
            isActive={isActive}
            presentationMode={presentationMode}
            theme={theme}
          />
        )
      })}
    </main>
  )
}
