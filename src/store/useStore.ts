import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { CachedExcalidrawScene, ExcalidrawFile, FileTreeNode, OpenTab, Preferences } from '../types'
import { convertPreferencesFromRust, convertPreferencesToRust } from '../lib/preferences'
import { ask } from '@tauri-apps/plugin-dialog'
import { clampSidebarWidth, DEFAULT_SIDEBAR_WIDTH } from '../lib/layout'
import {
  normalizePathForComparison,
  pathBasename,
  pathsEqual,
} from '../lib/path'
import { getUnsavedTabs, isUnsavedTab } from '../lib/tabLifecycle'
import {
  rekeySaveOperation,
  type SaveOperations,
} from '../lib/saveStatus'
import { flushPendingEditorScene } from '../lib/editorSceneSync'

type UnsavedChangesDecision = 'save' | 'discard' | 'cancel'
type FileLoadSource = 'cache' | 'disk' | null
let nextSaveOperationId = 0
let nextTabInstanceId = 0
let nextFileTreeRequestId = 0
const fileWriteQueues = new Map<string, Promise<void>>()
const saveAsDestinationClaims = new Set<string>()
let externalReconciliationQueue = Promise.resolve()

function reserveFileOperation(path: string) {
  const pathKey = normalizePathForComparison(path)
  const previousOperation = fileWriteQueues.get(pathKey) ?? Promise.resolve()
  let releaseOperation!: () => void
  const currentOperation = new Promise<void>((resolve) => {
    releaseOperation = resolve
  })

  fileWriteQueues.set(pathKey, currentOperation)

  return async <T>(operation: () => Promise<T>): Promise<T> => {
    await previousOperation

    try {
      return await operation()
    } finally {
      releaseOperation()
      if (fileWriteQueues.get(pathKey) === currentOperation) {
        fileWriteQueues.delete(pathKey)
      }
    }
  }
}

async function serializeFileOperation<T>(
  path: string,
  operation: () => Promise<T>
): Promise<T> {
  return reserveFileOperation(path)(operation)
}

async function serializeExternalReconciliation(
  reconciliation: () => Promise<void>
): Promise<void> {
  const previousReconciliation = externalReconciliationQueue
  let releaseReconciliation!: () => void
  externalReconciliationQueue = new Promise<void>((resolve) => {
    releaseReconciliation = resolve
  })

  await previousReconciliation
  try {
    await reconciliation()
  } finally {
    releaseReconciliation()
  }
}

export class DeletionFallbackValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DeletionFallbackValidationError'
  }
}

function toRecoveryTab(tab: OpenTab): OpenTab {
  return {
    ...synchronizeTabScene(tab),
    modified: true,
    recoveryState: 'deleted-on-disk',
    externalConflict: undefined,
    lifecycleVersion: nextLifecycleVersion(tab),
  }
}

export class DeletionRecoveryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DeletionRecoveryError'
  }
}

interface FileContentResult {
  content: string
  content_hash: string
  file_identity: string
}

interface ExternalFileInspection {
  snapshot: OpenTab
  wasUnsaved: boolean
  disk: FileContentResult | null
  missing: boolean
  inspectionFailed: boolean
}

interface SaveFileResult {
  content_hash: string
  file_identity: string
}

async function getDeletionScopeTabIds(
  targetPath: string,
  isDirectory: boolean,
  tabs: OpenTab[]
): Promise<Set<string>> {
  if (tabs.length === 0) {
    return new Set()
  }

  const matches = await invoke<boolean[]>('get_deletion_scope_matches', {
    targetPath,
    isDirectory,
    candidatePaths: tabs.map((tab) => tab.path),
  })
  if (!Array.isArray(matches) || matches.length !== tabs.length) {
    throw new Error('The native deletion scope response was invalid.')
  }

  return new Set(
    tabs
      .filter((_, index) => matches[index])
      .map((tab) => tab.tabId)
  )
}

function parseSceneFromContent(content: string): CachedExcalidrawScene {
  const data = JSON.parse(content)

  return {
    elements: data.elements || [],
    appState: data.appState || {},
    files: data.files || {},
  }
}

function toOpenTab(
  file: ExcalidrawFile,
  content: string,
  contentHash: string,
  fileIdentity: string,
  sceneVersion = 0
): OpenTab {
  return {
    ...file,
    tabId: file.tabId ?? `tab-${++nextTabInstanceId}`,
    cachedContent: content,
    contentHash,
    fileIdentity,
    cachedScene: parseSceneFromContent(content),
    sceneVersion,
    lifecycleVersion: 0,
  }
}

function toExcalidrawFile(tab: OpenTab): ExcalidrawFile {
  return {
    name: tab.name,
    path: tab.path,
    modified: tab.modified,
    tabId: tab.tabId,
  }
}

async function readOpenTabFromDisk(file: ExcalidrawFile, sceneVersion = 0): Promise<OpenTab> {
  const {
    content,
    content_hash: contentHash,
    file_identity: fileIdentity,
  } = await invoke<FileContentResult>(
    'read_file_with_hash',
    { filePath: file.path }
  )

  return toOpenTab(
    { ...file, modified: false },
    content,
    contentHash,
    fileIdentity,
    sceneVersion
  )
}

interface PreparedFallbackTab {
  tab: OpenTab
  source: Exclude<FileLoadSource, null>
}

function synchronizeTabScene(tab: OpenTab): OpenTab {
  return {
    ...tab,
    cachedScene: parseSceneFromContent(tab.cachedContent),
  }
}

function nextLifecycleVersion(tab: OpenTab): number {
  return (tab.lifecycleVersion ?? 0) + 1
}

function hasSameTabSnapshot(current: OpenTab, snapshot: OpenTab): boolean {
  return current.tabId === snapshot.tabId &&
    current.path === snapshot.path &&
    current.cachedContent === snapshot.cachedContent &&
    current.contentHash === snapshot.contentHash &&
    current.fileIdentity === snapshot.fileIdentity &&
    current.modified === snapshot.modified &&
    current.sceneVersion === snapshot.sceneVersion &&
    current.recoveryState === snapshot.recoveryState &&
    current.externalConflict === snapshot.externalConflict &&
    (current.lifecycleVersion ?? 0) === (snapshot.lifecycleVersion ?? 0)
}

function retainsDiskBaseline(current: OpenTab, snapshot: OpenTab): boolean {
  return current.tabId === snapshot.tabId &&
    current.path === snapshot.path &&
    current.contentHash === snapshot.contentHash &&
    current.fileIdentity === snapshot.fileIdentity &&
    current.recoveryState === snapshot.recoveryState &&
    (current.lifecycleVersion ?? 0) === (snapshot.lifecycleVersion ?? 0)
}

function hasSameSavableContent(current: OpenTab, snapshot: OpenTab): boolean {
  return current.tabId === snapshot.tabId &&
    current.path === snapshot.path &&
    current.cachedContent === snapshot.cachedContent &&
    current.recoveryState === snapshot.recoveryState &&
    current.externalConflict === snapshot.externalConflict &&
    (current.lifecycleVersion ?? 0) === (snapshot.lifecycleVersion ?? 0)
}

function haveSameScopedTabs(
  snapshotTabs: OpenTab[],
  currentTabs: OpenTab[],
  isInScope: (tab: OpenTab) => boolean
): boolean {
  const scopedSnapshots = snapshotTabs.filter(isInScope)
  const currentScopedTabs = currentTabs.filter(isInScope)

  return scopedSnapshots.length === currentScopedTabs.length &&
    scopedSnapshots.every((snapshot) => {
      const current = currentScopedTabs.find((tab) => tab.tabId === snapshot.tabId)
      return Boolean(current && hasSameTabSnapshot(current, snapshot))
    })
}

interface StableDeletionScope {
  tabs: OpenTab[]
  tabIds: Set<string>
}

async function getStableDeletionScope(
  getTabs: () => OpenTab[],
  targetPath: string,
  isDirectory: boolean
): Promise<StableDeletionScope> {
  while (true) {
    const tabs = getTabs()
    const tabIds = await getDeletionScopeTabIds(targetPath, isDirectory, tabs)
    const currentTabs = getTabs()
    if (
      tabs.length === currentTabs.length &&
      tabs.every((snapshot, index) => {
        const current = currentTabs[index]
        return current?.tabId === snapshot.tabId &&
          hasSameTabSnapshot(current, snapshot)
      })
    ) {
      return { tabs, tabIds }
    }
  }
}

async function resolveDeletionPreflight(
  getTabs: () => OpenTab[],
  targetPath: string,
  isDirectory: boolean,
  context: string,
  saveTab: (tab: OpenTab) => Promise<boolean>
): Promise<StableDeletionScope | null> {
  const discardedSnapshots = new Map<string, OpenTab>()
  while (true) {
    const scope = await getStableDeletionScope(
      getTabs,
      targetPath,
      isDirectory
    )
    const canDelete = await resolveScopedUnsavedTabs(
      getTabs,
      (tab) => scope.tabIds.has(tab.tabId),
      context,
      saveTab,
      discardedSnapshots
    )
    if (!canDelete) {
      return null
    }

    const currentScope = await getStableDeletionScope(
      getTabs,
      targetPath,
      isDirectory
    )
    const unresolved = currentScope.tabs.some((tab) => {
      if (!currentScope.tabIds.has(tab.tabId) || !isUnsavedTab(tab)) {
        return false
      }
      const discarded = discardedSnapshots.get(tab.tabId)
      return !discarded || !hasSameTabSnapshot(tab, discarded)
    })
    if (!unresolved) {
      return currentScope
    }
  }
}

async function prepareFallbackTab(
  tab: OpenTab
): Promise<PreparedFallbackTab> {
  if (tab.modified) {
    return {
      tab: synchronizeTabScene(tab),
      source: 'cache',
    }
  }

  const disk = await invoke<FileContentResult>('read_file_with_hash', {
    filePath: tab.path,
  })
  if (
    disk.content_hash === tab.contentHash &&
    disk.file_identity === tab.fileIdentity
  ) {
    return { tab, source: 'cache' }
  }

  return {
    tab: toOpenTab(
      toExcalidrawFile(tab),
      disk.content,
      disk.content_hash,
      disk.file_identity,
      tab.sceneVersion + 1
    ),
    source: 'disk',
  }
}

async function revalidateCleanFallbackAfterDelete(
  fallbackSnapshot: OpenTab | undefined,
  currentTabs: OpenTab[]
): Promise<PreparedFallbackTab | null> {
  if (!fallbackSnapshot || fallbackSnapshot.modified) {
    return null
  }

  const currentFallback = currentTabs.find(
    (tab) => tab.tabId === fallbackSnapshot.tabId
  )
  if (
    !currentFallback ||
    currentFallback.modified ||
    !hasSameTabSnapshot(currentFallback, fallbackSnapshot)
  ) {
    return null
  }

  return prepareFallbackTab(currentFallback)
}

function resolveFallbackTab(
  openTabs: OpenTab[],
  preferredIndex: number,
  fallbackSnapshot: OpenTab | undefined,
  preparedFallback: PreparedFallbackTab | null
): {
  openTabs: OpenTab[]
  fallbackTab: OpenTab | null
  source: FileLoadSource
  activationBlocked: boolean
} {
  const currentSnapshotTab = fallbackSnapshot
    ? openTabs.find((tab) => tab.tabId === fallbackSnapshot.tabId)
    : undefined
  const currentFallback = currentSnapshotTab ??
    openTabs[Math.min(Math.max(preferredIndex, 0), openTabs.length - 1)]

  if (!currentFallback) {
    return { openTabs, fallbackTab: null, source: null, activationBlocked: false }
  }

  const canUsePreparedFallback = Boolean(
    preparedFallback &&
    fallbackSnapshot &&
    hasSameTabSnapshot(currentFallback, fallbackSnapshot)
  )

  if (!canUsePreparedFallback && !currentFallback.modified) {
    return {
      openTabs: openTabs.map((tab) => {
        if (!tab.modified) return tab
        try {
          return synchronizeTabScene(tab)
        } catch (error) {
          console.error('[resolveFallbackTab] Failed to synchronize dirty tab:', error)
          return tab
        }
      }),
      fallbackTab: null,
      source: null,
      activationBlocked: true,
    }
  }

  let fallbackTab = canUsePreparedFallback
    ? preparedFallback!.tab
    : currentFallback
  const source: FileLoadSource = canUsePreparedFallback
    ? preparedFallback!.source
    : 'cache'

  if (!canUsePreparedFallback) {
    try {
      fallbackTab = synchronizeTabScene(fallbackTab)
    } catch (error) {
      console.error('[resolveFallbackTab] Failed to synchronize cached scene:', error)
      return {
        openTabs,
        fallbackTab: null,
        source: null,
        activationBlocked: true,
      }
    }

  }

  return {
    openTabs: openTabs.map((tab) =>
      tab.tabId === fallbackTab.tabId ? fallbackTab : tab
    ),
    fallbackTab,
    source,
    activationBlocked: false,
  }
}

function findChangedScopedTabs(
  snapshotTabs: OpenTab[],
  currentTabs: OpenTab[],
  isInScope: (tab: OpenTab) => boolean
): OpenTab[] {
  const scopedSnapshots = snapshotTabs.filter(isInScope)

  return currentTabs.filter(isInScope).filter((current) => {
    const snapshot = scopedSnapshots.find((tab) => tab.tabId === current.tabId)
    return !snapshot || !hasSameTabSnapshot(current, snapshot)
  })
}

async function confirmUnsavedChanges(
  fileName: string,
  actionDescription: string
): Promise<UnsavedChangesDecision> {
  const shouldSave = await ask(
    `Do you want to save changes to "${fileName}" before ${actionDescription}?`,
    {
      title: 'Unsaved Changes',
      kind: 'warning',
      okLabel: 'Save',
      cancelLabel: "Don't Save",
    }
  )

  if (shouldSave) {
    return 'save'
  }

  const shouldDiscard = await ask(
    `Discard unsaved changes to "${fileName}"?`,
    {
      title: 'Discard Unsaved Changes',
      kind: 'warning',
      okLabel: "Don't Save",
      cancelLabel: 'Cancel',
    }
  )

  return shouldDiscard ? 'discard' : 'cancel'
}

async function resolveScopedUnsavedTabs(
  getOpenTabs: () => OpenTab[],
  isInScope: (tab: OpenTab) => boolean,
  actionDescription: string,
  saveTab: (tab: OpenTab) => Promise<boolean>,
  discardedSnapshots = new Map<string, OpenTab>()
): Promise<boolean> {
  while (true) {
    const unresolved = getUnsavedTabs(getOpenTabs())
      .filter(isInScope)
      .filter((tab) => {
        const discarded = discardedSnapshots.get(tab.tabId)
        return !discarded || !hasSameTabSnapshot(tab, discarded)
      })
    if (unresolved.length === 0) {
      return true
    }

    const tabSnapshot = unresolved[0]
    const decision = await confirmUnsavedChanges(
      tabSnapshot.name,
      actionDescription
    )
    if (decision === 'cancel') {
      return false
    }

    const currentTab = getOpenTabs().find(
      (tab) => tab.tabId === tabSnapshot.tabId
    )
    if (
      !currentTab ||
      !isInScope(currentTab) ||
      !hasSameTabSnapshot(currentTab, tabSnapshot)
    ) {
      continue
    }

    if (decision === 'discard') {
      discardedSnapshots.set(currentTab.tabId, currentTab)
      continue
    }
    if (!(await saveTab(currentTab))) {
      return false
    }
  }
}

function isPathInsideDirectory(path: string, directory: string): boolean {
  const normalizedPath = normalizePathForComparison(path)
  const normalizedDirectory = normalizePathForComparison(directory)
  return normalizedPath === normalizedDirectory ||
    normalizedPath.startsWith(`${normalizedDirectory}/`)
}

function replacePathPrefix(path: string, oldPrefix: string, newPrefix: string): string {
  if (path === oldPrefix) {
    return newPrefix
  }

  if (path.startsWith(`${oldPrefix}/`) || path.startsWith(`${oldPrefix}\\`)) {
    return `${newPrefix}${path.slice(oldPrefix.length)}`
  }

  return path
}

function isMissingFileError(error: unknown): boolean {
  const message = String(error).toLowerCase()
  return message.includes('no such file') ||
    message.includes('not found') ||
    message.includes('cannot find the file')
}

interface AppStore {
  // State
  currentDirectory: string | null
  files: ExcalidrawFile[]
  fileTree: FileTreeNode[]
  activeFile: ExcalidrawFile | null
  fileContent: string | null
  activeFileLoadSource: FileLoadSource
  preferences: Preferences
  sidebarVisible: boolean
  isDirty: boolean
  presentationMode: boolean
  openTabs: OpenTab[]
  saveOperations: SaveOperations

  // Actions
  updateTabContent: (
    tabId: string,
    sceneVersion: number,
    content: string,
    scene: CachedExcalidrawScene
  ) => void
  applySaveAsResult: (
    oldPath: string,
    newPath: string,
    content: string,
    contentHash: string,
    fileIdentity: string,
    saveOperationId?: string,
    sourceTabId?: string
  ) => boolean
  beginSaveOperation: (filePath: string) => string
  endSaveOperation: (operationId: string) => void
  setPreferences: (prefs: Preferences) => void
  setSidebarWidth: (width: number) => void
  setIsDirty: (dirty: boolean) => void
  markFileAsModified: (
    filePath: string,
    modified: boolean,
    tabId?: string
  ) => void
  markTreeNodeAsModified: (filePath: string, modified: boolean) => void
  togglePresentationMode: () => void
  closeTab: (filePath: string, tabId?: string) => Promise<void>

  // Async actions
  loadDirectory: (dir: string) => Promise<boolean>
  loadFileTree: (dir: string) => Promise<void>
  loadFile: (file: ExcalidrawFile) => Promise<void>
  loadFileFromTree: (node: FileTreeNode) => Promise<void>
  saveCurrentFile: (content?: string) => Promise<boolean>
  saveTabAs: (
    filePath: string,
    forbiddenDirectory?: string,
    tabId?: string
  ) => Promise<string | null>
  saveTabForWorkspaceResolution: (
    filePath: string,
    forbiddenDirectory?: string,
    tabId?: string
  ) => Promise<boolean>
  resolveUnsavedTabsBeforeWorkspaceChange: () => Promise<boolean>
  reconcileActiveFileAfterExternalChange: () => Promise<void>
  createNewFile: (fileName?: string, directory?: string) => Promise<void>
  createNewFolder: (folderName?: string, directory?: string) => Promise<void>
  renameFile: (oldPath: string, newName: string) => Promise<void>
  renameFolder: (oldPath: string, newName: string) => Promise<void>
  deleteFile: (filePath: string) => Promise<boolean>
  deleteFolder: (folderPath: string) => Promise<boolean>
  loadPreferences: () => Promise<void>
  savePreferences: () => Promise<void>
  toggleSidebar: () => void
}

type DeletionTabState = Pick<
  AppStore,
  'openTabs' | 'activeFile' | 'fileContent' | 'activeFileLoadSource' | 'isDirty'
>

function reconcilePostDeleteRecovery(
  currentState: DeletionTabState,
  snapshotTabs: OpenTab[],
  isInScope: (tab: OpenTab) => boolean
): Partial<DeletionTabState> | null {
  const changedTabs = findChangedScopedTabs(snapshotTabs, currentState.openTabs, isInScope)
  if (changedTabs.length === 0) {
    return null
  }

  const recoveryTabIds = new Set(changedTabs.map((tab) => tab.tabId))
  const openTabs = currentState.openTabs.flatMap((tab) => {
    if (!isInScope(tab)) {
      return [tab]
    }
    if (!recoveryTabIds.has(tab.tabId)) {
      return []
    }

    return [toRecoveryTab(tab)]
  })

  if (!currentState.activeFile || !isInScope(currentState.activeFile as OpenTab)) {
    return { openTabs }
  }

  const activeRecovery = openTabs.find(
    (tab) => tab.tabId === currentState.activeFile?.tabId
  ) ??
    openTabs.find((tab) => tab.path === currentState.activeFile?.path) ??
    openTabs.find((tab) => tab.recoveryState === 'deleted-on-disk')
  if (!activeRecovery) {
    return {
      openTabs,
      activeFile: null,
      fileContent: null,
      activeFileLoadSource: null,
      isDirty: false,
    }
  }

  return {
    openTabs,
    activeFile: toExcalidrawFile(activeRecovery),
    fileContent: activeRecovery.cachedContent,
    activeFileLoadSource: 'cache',
    isDirty: true,
  }
}

export const useStore = create<AppStore>((set, get) => ({
  // Initial state
  currentDirectory: null,
  files: [],
  fileTree: [],
  activeFile: null,
  fileContent: null,
  activeFileLoadSource: null,
  preferences: {
    lastDirectory: null,
    recentDirectories: [],
    theme: 'system',
    sidebarVisible: true,
    sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
    showDecorations: true,
  },
  sidebarVisible: true,
  isDirty: false,
  presentationMode: false,
  openTabs: [],
  saveOperations: {},

  // Targeted synchronous actions
  updateTabContent: (tabId, sceneVersion, content, scene) => set((state) => {
    const tab = state.openTabs.find((candidate) => candidate.tabId === tabId)
    if (!tab || tab.sceneVersion !== sceneVersion) {
      return state
    }

    const isActive = state.activeFile?.tabId === tabId
    return {
      fileContent: isActive ? content : state.fileContent,
      openTabs: state.openTabs.map((candidate) =>
        candidate.tabId === tabId
          ? { ...candidate, cachedContent: content, cachedScene: scene }
          : candidate
      ),
    }
  }),
  applySaveAsResult: (
    oldPath,
    newPath,
    content,
    contentHash,
    fileIdentity,
    saveOperationId,
    sourceTabId
  ) => {
    const state = get()
    const sourceTab = state.openTabs.find((tab) =>
      sourceTabId ? tab.tabId === sourceTabId : tab.path === oldPath
    )
    if (!sourceTab) {
      console.error('[applySaveAsResult] Active tab was not found:', oldPath)
      return false
    }
    if (state.openTabs.some(
      (tab) => tab.tabId !== sourceTab.tabId && pathsEqual(tab.path, newPath)
    )) {
      console.error('[applySaveAsResult] Save destination is already open:', newPath)
      return false
    }

    const updatedTab: OpenTab = {
      ...sourceTab,
      name: pathBasename(newPath),
      path: newPath,
      modified: false,
      cachedContent: content,
      contentHash,
      fileIdentity,
      cachedScene: parseSceneFromContent(content),
      recoveryState: undefined,
      externalConflict: undefined,
      lifecycleVersion: nextLifecycleVersion(sourceTab),
    }

    const sourceIsActive = state.activeFile?.tabId
      ? state.activeFile.tabId === sourceTab.tabId
      : state.activeFile?.path === oldPath
    set({
      activeFile: sourceIsActive
        ? toExcalidrawFile(updatedTab)
        : state.activeFile,
      fileContent: sourceIsActive ? content : state.fileContent,
      activeFileLoadSource: sourceIsActive ? 'cache' : state.activeFileLoadSource,
      isDirty: sourceIsActive ? false : state.isDirty,
      openTabs: state.openTabs.map((tab) =>
        tab.tabId === sourceTab.tabId ? updatedTab : tab
      ),
      saveOperations: rekeySaveOperation(
        state.saveOperations,
        saveOperationId,
        oldPath,
        newPath
      ),
    })
    return true
  },
  beginSaveOperation: (filePath) => {
    const operationId = `save-${++nextSaveOperationId}`
    set((state) => ({
      saveOperations: {
        ...state.saveOperations,
        [operationId]: filePath,
      },
    }))
    return operationId
  },
  endSaveOperation: (operationId) => {
    set((state) => {
      if (!(operationId in state.saveOperations)) {
        return state
      }

      const saveOperations = { ...state.saveOperations }
      delete saveOperations[operationId]
      return { saveOperations }
    })
  },
  setPreferences: (prefs) => set({ preferences: prefs }),
  setSidebarWidth: (width) => {
    const sidebarWidth = clampSidebarWidth(width)
    set((state) => ({
      preferences: { ...state.preferences, sidebarWidth },
    }))
    void get().savePreferences()
  },
  setIsDirty: (dirty) => set({ isDirty: dirty }),

  markFileAsModified: (filePath, modified, tabId) => {
    set((state) => {
      const openTabs = state.openTabs.map((f) =>
        (tabId ? f.tabId === tabId : f.path === filePath)
          ? { ...f, modified }
          : f
      )
      const pathIsUnsaved = openTabs.some(
        (tab) => tab.path === filePath && isUnsavedTab(tab)
      )
      return {
        files: state.files.map((f) =>
          f.path === filePath ? { ...f, modified: pathIsUnsaved } : f
        ),
        openTabs,
      }
    })
  },

  markTreeNodeAsModified: (filePath, modified) => {
    const pathIsUnsaved = modified || get().openTabs.some(
      (tab) => tab.path === filePath && isUnsavedTab(tab)
    )
    const updateNode = (nodes: FileTreeNode[]): FileTreeNode[] => {
      return nodes.map(node => {
        if (node.path === filePath) {
          return { ...node, modified: pathIsUnsaved }
        }
        if (node.children) {
          return { ...node, children: updateNode(node.children) }
        }
        return node
      })
    }

    set((state) => ({
      fileTree: updateNode(state.fileTree)
    }))
  },

  // Load directory and list files
  loadDirectory: async (dir) => {
    try {
      const [files, fileTree] = await Promise.all([
        invoke<ExcalidrawFile[]>('list_excalidraw_files', { directory: dir }),
        invoke<FileTreeNode[]>('get_file_tree', { directory: dir })
      ])

      if (!(await get().resolveUnsavedTabsBeforeWorkspaceChange())) {
        return false
      }

      const state = get()
      if (state.presentationMode && state.preferences.showDecorations) {
        await invoke('set_menu_visible', { visible: true }).catch((error) => {
          console.error('Failed to restore menu before loading directory:', error)
        })
      }

      set({
        currentDirectory: dir,
        files,
        fileTree,
        activeFile: null,
        fileContent: null,
        activeFileLoadSource: null,
        isDirty: false,
        presentationMode: false,
        openTabs: [],
      })

      // Update preferences with recent directory
      const prefs = get().preferences
      // Ensure recentDirectories is always an array
      const currentRecentDirs = prefs.recentDirectories || []
      const recentDirs = currentRecentDirs.filter((d) => d !== dir)
      recentDirs.unshift(dir)
      if (recentDirs.length > 10) {
        recentDirs.pop()
      }

      const newPrefs: Preferences = {
        ...prefs,
        lastDirectory: dir,
        recentDirectories: recentDirs,
      }

      set({ preferences: newPrefs })
      await get().savePreferences()

      // Start watching directory
      await invoke('watch_directory', { directory: dir })
      return true
    } catch (error) {
      console.error('Failed to load directory:', error)
      // Show user-friendly error message
      alert(`Failed to load directory: ${error}`)
      return false
    }
  },

  // Load file tree only
  loadFileTree: async (dir) => {
    const requestId = ++nextFileTreeRequestId
    try {
      const fileTree = await invoke<FileTreeNode[]>('get_file_tree', {
        directory: dir,
      })

      const currentDirectory = get().currentDirectory
      if (
        requestId !== nextFileTreeRequestId ||
        currentDirectory === null ||
        !pathsEqual(currentDirectory, dir)
      ) {
        return
      }
      set({ fileTree })
    } catch (error) {
      console.error('Failed to load file tree:', error)
    }
  },

  reconcileActiveFileAfterExternalChange: async () => {
    const reconciliationState = get()
    const tabsByExactPath = new Map<string, OpenTab[]>()
    for (const tab of reconciliationState.openTabs) {
      const tabs = tabsByExactPath.get(tab.path) ?? []
      tabs.push(tab)
      tabsByExactPath.set(tab.path, tabs)
    }
    const divergentDuplicatePaths = new Set(
      Array.from(tabsByExactPath)
        .filter(([, tabs]) =>
          tabs.length > 1 &&
          tabs.some((tab) => !hasSameTabSnapshot(tab, tabs[0]))
        )
        .map(([path]) => path)
    )
    if (divergentDuplicatePaths.size > 0) {
      set((state) => ({
        activeFile:
          state.activeFile && divergentDuplicatePaths.has(state.activeFile.path)
            ? { ...state.activeFile, modified: true }
            : state.activeFile,
        isDirty:
          state.activeFile && divergentDuplicatePaths.has(state.activeFile.path)
            ? true
            : state.isDirty,
        openTabs: state.openTabs.map((tab) => {
          if (
            !divergentDuplicatePaths.has(tab.path) ||
            tab.recoveryState === 'deleted-on-disk' ||
            (tab.modified && tab.externalConflict === 'modified-on-disk')
          ) {
            return tab
          }
          return {
            ...synchronizeTabScene(tab),
            modified: true,
            externalConflict: 'modified-on-disk',
            lifecycleVersion: nextLifecycleVersion(tab),
          }
        }),
      }))
      for (const path of divergentDuplicatePaths) {
        get().markTreeNodeAsModified(path, true)
      }
    }

    const candidateGroups = new Map<
      string,
      Array<{ tabId: string; path: string; wasUnsaved: boolean }>
    >()
    for (const tab of reconciliationState.openTabs) {
      if (
        tab.recoveryState === 'deleted-on-disk' ||
        divergentDuplicatePaths.has(tab.path)
      ) {
        continue
      }
      const pathKey = normalizePathForComparison(tab.path)
      const candidates = candidateGroups.get(pathKey) ?? []
      if (candidates.some((candidate) => candidate.tabId === tab.tabId)) {
        continue
      }
      const wasUnsaved =
        tab.modified ||
        tab.externalConflict === 'modified-on-disk' ||
        (
          reconciliationState.activeFile?.path === tab.path &&
          reconciliationState.isDirty
        )
      candidates.push({ tabId: tab.tabId, path: tab.path, wasUnsaved })
      candidateGroups.set(pathKey, candidates)
    }
    if (candidateGroups.size === 0) {
      return
    }

    const inspectCandidate = async (
      candidate: { tabId: string; path: string; wasUnsaved: boolean }
    ): Promise<ExternalFileInspection | null> => {
      const tab = get().openTabs.find(
        (openTab) => openTab.tabId === candidate.tabId
      )
      if (!tab || tab.recoveryState === 'deleted-on-disk') {
        return null
      }

      try {
        const disk = await invoke<FileContentResult>('read_file_with_hash', {
          filePath: tab.path,
        })
        return {
          snapshot: tab,
          wasUnsaved: candidate.wasUnsaved,
          disk,
          missing: false,
          inspectionFailed: false,
        }
      } catch (error) {
        if (isMissingFileError(error)) {
          return {
            snapshot: tab,
            wasUnsaved: candidate.wasUnsaved,
            disk: null,
            missing: true,
            inspectionFailed: false,
          }
        }
        console.error(
          '[reconcileActiveFileAfterExternalChange] Failed to inspect file:',
          tab.path,
          error
        )
        return {
          snapshot: tab,
          wasUnsaved: candidate.wasUnsaved,
          disk: null,
          missing: false,
          inspectionFailed: true,
        }
      }
    }

    const inspections = Array.from(candidateGroups.values()).map((candidates) => {
      const runReservedInspection = reserveFileOperation(candidates[0].path)
      let startInspection!: () => void
      const inspectionTurn = new Promise<void>((resolve) => {
        startInspection = resolve
      })
      let finishInspection!: () => void
      const inspectionApplied = new Promise<void>((resolve) => {
        finishInspection = resolve
      })
      let publishResults!: (results: ExternalFileInspection[]) => void
      const result = new Promise<ExternalFileInspection[]>((resolve) => {
        publishResults = resolve
      })
      const completion = runReservedInspection(async () => {
        await inspectionTurn
        const results: ExternalFileInspection[] = []
        for (const candidate of candidates) {
          const result = await inspectCandidate(candidate)
          if (result) {
            results.push(result)
          }
        }
        publishResults(results)
        await inspectionApplied
      })
      return { startInspection, finishInspection, result, completion }
    })

    await serializeExternalReconciliation(async () => {
      for (const inspection of inspections) {
        inspection.startInspection()
      }
      const results = await Promise.all(
        inspections.map((inspection) => inspection.result)
      ).then((inspectionResults) => inspectionResults.flat())

      try {
        set((currentState) => {
        let openTabs = currentState.openTabs
        let activeFile = currentState.activeFile
        let fileContent = currentState.fileContent
        let activeFileLoadSource = currentState.activeFileLoadSource
        let isDirty = currentState.isDirty
        let changed = false

        for (const result of results) {
          if (!result) {
            continue
          }
          const currentTab = openTabs.find(
            (tab) => tab.tabId === result.snapshot.tabId
          )
          if (
            !currentTab ||
            currentTab.recoveryState === 'deleted-on-disk' ||
            !retainsDiskBaseline(currentTab, result.snapshot)
          ) {
            continue
          }

          const isActive = activeFile?.tabId
            ? activeFile.tabId === currentTab.tabId
            : activeFile?.path === currentTab.path
          const hasUnsavedContent =
            result.wasUnsaved ||
            currentTab.modified ||
            currentTab.externalConflict === 'modified-on-disk' ||
            (isActive && isDirty)

        if (result.inspectionFailed) {
          if (currentTab.externalConflict !== 'modified-on-disk') {
            const conflictTab: OpenTab = {
              ...synchronizeTabScene(currentTab),
              modified: true,
              externalConflict: 'modified-on-disk',
              lifecycleVersion: nextLifecycleVersion(currentTab),
            }
            openTabs = openTabs.map((tab) =>
              tab.tabId === currentTab.tabId ? conflictTab : tab
            )
            if (isActive) {
              activeFile = toExcalidrawFile(conflictTab)
              fileContent = conflictTab.cachedContent
              activeFileLoadSource = 'cache'
              isDirty = true
            }
            changed = true
          }
          continue
        }

        if (result.missing) {
          if (hasUnsavedContent) {
            const recoveryTab = toRecoveryTab(currentTab)
            openTabs = openTabs.map((tab) =>
              tab.tabId === currentTab.tabId ? recoveryTab : tab
            )
            if (isActive) {
              activeFile = toExcalidrawFile(recoveryTab)
              fileContent = recoveryTab.cachedContent
              activeFileLoadSource = 'cache'
              isDirty = true
            }
          } else {
            openTabs = openTabs.filter((tab) => tab.path !== currentTab.path)
            if (isActive) {
              activeFile = null
              fileContent = null
              activeFileLoadSource = null
              isDirty = false
            }
          }
          changed = true
          continue
        }

        if (!result.disk) {
          continue
        }

        const diskChanged =
          result.disk.content_hash !== currentTab.contentHash ||
          result.disk.file_identity !== currentTab.fileIdentity
        if (!diskChanged) {
          if (currentTab.externalConflict === 'modified-on-disk') {
            const resolvedTab = {
              ...currentTab,
              externalConflict: undefined,
              lifecycleVersion: nextLifecycleVersion(currentTab),
            }
            openTabs = openTabs.map((tab) =>
              tab.tabId === currentTab.tabId ? resolvedTab : tab
            )
            if (isActive) {
              activeFile = toExcalidrawFile(resolvedTab)
              isDirty = resolvedTab.modified
            }
            changed = true
          }
          continue
        }

        if (hasUnsavedContent) {
          if (currentTab.externalConflict !== 'modified-on-disk') {
            const conflictTab: OpenTab = {
              ...synchronizeTabScene(currentTab),
              modified: true,
              externalConflict: 'modified-on-disk',
              lifecycleVersion: nextLifecycleVersion(currentTab),
            }
            openTabs = openTabs.map((tab) =>
              tab.tabId === currentTab.tabId ? conflictTab : tab
            )
            if (isActive) {
              activeFile = toExcalidrawFile(conflictTab)
              fileContent = conflictTab.cachedContent
              activeFileLoadSource = 'cache'
              isDirty = true
            }
            changed = true
          }
          continue
        }

        const reloadedTab: OpenTab = {
          ...toOpenTab(
            toExcalidrawFile(currentTab),
            result.disk.content,
            result.disk.content_hash,
            result.disk.file_identity,
            currentTab.sceneVersion + 1
          ),
          lifecycleVersion: nextLifecycleVersion(currentTab),
        }
        openTabs = openTabs.map((tab) =>
          tab.tabId === currentTab.tabId ? reloadedTab : tab
        )
        if (isActive) {
          activeFile = toExcalidrawFile(reloadedTab)
          fileContent = reloadedTab.cachedContent
          activeFileLoadSource = 'disk'
          isDirty = false
        }
        changed = true
        }

        return changed
          ? { openTabs, activeFile, fileContent, activeFileLoadSource, isDirty }
          : currentState
        })
      } finally {
        for (const inspection of inspections) {
          inspection.finishInspection()
        }
      }
      await Promise.all(inspections.map((inspection) => inspection.completion))
    })
  },

  // Load file content
  loadFile: async (file) => {
    const state = get()

    // If clicking the same file that's already active, do nothing
    if (
      file.tabId
        ? state.activeFile?.tabId === file.tabId
        : state.activeFile?.path === file.path
    ) {
      return
    }

    // Check if current file has unsaved changes
    if (state.isDirty && state.activeFile) {
      const decision = await confirmUnsavedChanges(state.activeFile.name, 'switching files')

      if (decision === 'save') {
        const saved = await state.saveCurrentFile()
        if (!saved) {
          return
        }
      } else if (decision === 'cancel') {
        return
      } else {
        try {
          const existingTab = get().openTabs.find((tab) =>
            state.activeFile?.tabId
              ? tab.tabId === state.activeFile.tabId
              : tab.path === state.activeFile?.path
          )
          if (existingTab?.recoveryState === 'deleted-on-disk') {
            set((currentState) => ({
              activeFile: null,
              fileContent: null,
              activeFileLoadSource: null,
              isDirty: false,
              openTabs: currentState.openTabs.filter(
                (tab) => tab.tabId !== existingTab.tabId
              ),
            }))
          } else {
            const cleanTab = await readOpenTabFromDisk(
              state.activeFile,
              (existingTab?.sceneVersion || 0) + 1
            )

            set((currentState) => ({
              activeFile: toExcalidrawFile(cleanTab),
              fileContent: cleanTab.cachedContent,
              activeFileLoadSource: 'disk',
              isDirty: false,
              openTabs: currentState.openTabs.map((tab) =>
                tab.tabId === cleanTab.tabId ? cleanTab : tab
              ),
            }))
            state.markFileAsModified(cleanTab.path, false, cleanTab.tabId)
            state.markTreeNodeAsModified(cleanTab.path, false)
          }
        } catch (error) {
          console.error('Failed to discard unsaved changes:', error)
          alert(`Failed to discard unsaved changes: ${error}`)
          return
        }
      }
    }

    try {
      const latestState = get()
      const existingTab = latestState.openTabs.find((tab) =>
        file.tabId
          ? tab.tabId === file.tabId
          : pathsEqual(tab.path, file.path)
      )

      if (existingTab) {
        if (
          existingTab.recoveryState === 'deleted-on-disk' ||
          existingTab.externalConflict === 'modified-on-disk'
        ) {
          set({
            activeFile: toExcalidrawFile(existingTab),
            fileContent: existingTab.cachedContent,
            activeFileLoadSource: 'cache',
            isDirty: true,
          })
          return
        }

        let disk: FileContentResult
        try {
          disk = await invoke<FileContentResult>('read_file_with_hash', {
            filePath: existingTab.path,
          })
        } catch (error) {
          if (isMissingFileError(error) && existingTab.modified) {
            const currentTab = get().openTabs.find(
              (tab) => tab.tabId === existingTab.tabId
            )
            if (!currentTab) {
              return
            }
            const recoveryTab = toRecoveryTab(currentTab)
            set((currentState) => ({
              activeFile: toExcalidrawFile(recoveryTab),
              fileContent: recoveryTab.cachedContent,
              activeFileLoadSource: 'cache',
              isDirty: true,
              openTabs: currentState.openTabs.map((tab) =>
                tab.tabId === recoveryTab.tabId ? recoveryTab : tab
              ),
            }))
            return
          }
          throw error
        }

        const currentTab = get().openTabs.find(
          (tab) => tab.tabId === existingTab.tabId
        )
        if (!currentTab || !hasSameTabSnapshot(currentTab, existingTab)) {
          if (currentTab) {
            const hasUnsavedContent =
              currentTab.modified ||
              currentTab.recoveryState === 'deleted-on-disk' ||
              currentTab.externalConflict === 'modified-on-disk'
            set({
              activeFile: toExcalidrawFile(currentTab),
              fileContent: currentTab.cachedContent,
              activeFileLoadSource: 'cache',
              isDirty: hasUnsavedContent,
            })
          }
          return
        }

        const diskMatches =
          disk.content_hash === existingTab.contentHash &&
          disk.file_identity === existingTab.fileIdentity
        if (diskMatches) {
          set({
            activeFile: toExcalidrawFile(existingTab),
            fileContent: existingTab.cachedContent,
            activeFileLoadSource: 'cache',
            isDirty: existingTab.modified,
          })
          return
        }

        if (existingTab.modified) {
          const conflictTab: OpenTab = {
            ...synchronizeTabScene(existingTab),
            modified: true,
            externalConflict: 'modified-on-disk',
            lifecycleVersion: nextLifecycleVersion(existingTab),
          }
          set((currentState) => ({
            activeFile: toExcalidrawFile(conflictTab),
            fileContent: conflictTab.cachedContent,
            activeFileLoadSource: 'cache',
            isDirty: true,
            openTabs: currentState.openTabs.map((tab) =>
              tab.tabId === conflictTab.tabId ? conflictTab : tab
            ),
          }))
          return
        }

        const updatedTab = toOpenTab(
          toExcalidrawFile(existingTab),
          disk.content,
          disk.content_hash,
          disk.file_identity,
          existingTab.sceneVersion + 1
        )
        set((currentState) => ({
          activeFile: toExcalidrawFile(updatedTab),
          fileContent: updatedTab.cachedContent,
          activeFileLoadSource: 'disk',
          isDirty: false,
          openTabs: currentState.openTabs.map((tab) =>
            tab.tabId === updatedTab.tabId ? updatedTab : tab
          ),
        }))
        return
      }

      const updatedTab = await readOpenTabFromDisk(
        file,
        0
      )
      let openedNewTab = false
      set((currentState) => {
        const concurrentlyOpenedTab = currentState.openTabs.find((tab) =>
          pathsEqual(tab.path, updatedTab.path)
        )
        const tabToActivate = concurrentlyOpenedTab ?? updatedTab
        openedNewTab = !concurrentlyOpenedTab
        return {
          activeFile: toExcalidrawFile(tabToActivate),
          fileContent: tabToActivate.cachedContent,
          activeFileLoadSource: concurrentlyOpenedTab ? 'cache' : 'disk',
          isDirty: isUnsavedTab(tabToActivate),
          openTabs: concurrentlyOpenedTab
            ? currentState.openTabs
            : [...currentState.openTabs, updatedTab],
        }
      })

      if (openedNewTab) {
        state.markFileAsModified(file.path, false)
        state.markTreeNodeAsModified(file.path, false)
      }
    } catch (error) {
      console.error('Failed to load file:', error)

      // If file doesn't exist, refresh the tree and show error
      if (String(error).includes('No such file') || String(error).includes('not found')) {
        alert(`File not found: ${file.name}\n\nThe file may have been deleted or moved. Refreshing file list...`)

        // Clear active file if it's the one that failed
        if (
          file.tabId
            ? state.activeFile?.tabId === file.tabId
            : state.activeFile?.path === file.path
        ) {
          set({
            activeFile: null,
            fileContent: null,
            activeFileLoadSource: null,
            isDirty: false,
          })
        }

        // Refresh the file tree
        if (state.currentDirectory) {
          await state.loadFileTree(state.currentDirectory)
        }
      } else {
        // Other errors
        alert(`Failed to load file: ${error}`)
      }
    }
  },

  // Load file from tree node
  loadFileFromTree: async (node) => {
    if (node.is_directory) return

    await get().loadFile({
      name: node.name,
      path: node.path,
      modified: node.modified,
    })
  },

  // Save current file
  saveCurrentFile: async (content) => {
    flushPendingEditorScene(get().activeFile?.tabId)
    const state = get()
    const { activeFile, fileContent, isDirty } = state

    if (!activeFile) {
      return true
    }

    const activeTab = state.openTabs.find((tab) =>
      activeFile.tabId
        ? tab.tabId === activeFile.tabId
        : tab.path === activeFile.path
    )
    if (
      activeTab?.recoveryState === 'deleted-on-disk' ||
      activeTab?.externalConflict === 'modified-on-disk'
    ) {
      return Boolean(
        await state.saveTabAs(activeTab.path, undefined, activeTab.tabId)
      )
    }
    if (!activeTab) {
      return false
    }

    // Only save if file is dirty
    if (!isDirty && !content) {
      return true
    }

    const contentToSave = content || fileContent
    if (!contentToSave) {
      return false
    }

    // Validate JSON before saving
    try {
      const parsed = JSON.parse(contentToSave)
      if (!parsed || typeof parsed !== 'object') {
        console.error('[saveCurrentFile] Invalid JSON structure')
        return false
      }

    } catch (jsonError) {
      console.error('[saveCurrentFile] Invalid JSON, not saving:', jsonError)
      return false
    }

    const saveOperationId = state.beginSaveOperation(activeFile.path)
    try {
      return await serializeFileOperation(activeFile.path, async () => {
        const beforeWrite = get()
        const beforeWriteTab = beforeWrite.openTabs.find(
          (tab) => tab.tabId === activeTab.tabId
        )
        if (
          !beforeWriteTab ||
          beforeWriteTab.recoveryState === 'deleted-on-disk' ||
          beforeWriteTab.externalConflict === 'modified-on-disk' ||
          beforeWriteTab.cachedContent !== contentToSave ||
          (beforeWrite.activeFile?.tabId === activeTab.tabId &&
            beforeWrite.fileContent !== contentToSave)
        ) {
          alert('The drawing changed while waiting to be saved. The latest changes remain open.')
          return false
        }

        const {
          content_hash: contentHash,
          file_identity: fileIdentity,
        } = await invoke<SaveFileResult>('save_file', {
          filePath: activeFile.path,
          content: contentToSave,
          expectedHash: beforeWriteTab.contentHash,
          expectedIdentity: beforeWriteTab.fileIdentity,
        })
        const afterWrite = get()
        const afterWriteTab = afterWrite.openTabs.find(
          (tab) => tab.tabId === activeTab.tabId
        )
        const contentChanged =
          !afterWriteTab ||
          !hasSameTabSnapshot(afterWriteTab, beforeWriteTab) ||
          (afterWrite.activeFile?.tabId === activeTab.tabId &&
            afterWrite.fileContent !== contentToSave)
        if (contentChanged) {
          const currentTab = get().openTabs.find(
            (tab) => tab.tabId === activeTab.tabId
          )
          if (
            currentTab &&
            retainsDiskBaseline(currentTab, beforeWriteTab)
          ) {
            set((currentState) => ({
              openTabs: currentState.openTabs.map((tab) =>
                tab.tabId === currentTab.tabId
                  ? { ...tab, contentHash, fileIdentity }
                  : tab
              ),
            }))
          }
          if (currentTab && isUnsavedTab(currentTab)) {
            get().markTreeNodeAsModified(currentTab.path, true)
          }
          alert('The drawing changed while it was being saved. The latest changes remain open; save again before closing.')
          return false
        }

        set((currentState) => ({
          isDirty:
            currentState.activeFile?.tabId === activeTab.tabId
              ? false
              : currentState.isDirty,
          activeFile:
            currentState.activeFile?.tabId === activeTab.tabId
              ? { ...currentState.activeFile, modified: false }
              : currentState.activeFile,
          openTabs: currentState.openTabs.map((tab) =>
            tab.tabId === activeTab.tabId
              ? {
                  ...tab,
                  cachedContent: contentToSave,
                  contentHash,
                  fileIdentity,
                  modified: false,
                  recoveryState: undefined,
                  externalConflict: undefined,
                }
              : tab
          ),
        }))
        get().markFileAsModified(activeFile.path, false, activeTab.tabId)
        get().markTreeNodeAsModified(activeFile.path, false)
        return true
      })
    } catch (error) {
      console.error('[saveCurrentFile] Failed to save file:', error)
      alert(`Failed to save file: ${error}`)
      return false
    } finally {
      get().endSaveOperation(saveOperationId)
    }
  },

  saveTabAs: async (filePath, forbiddenDirectory, tabId) => {
    const requestedTab = get().openTabs.find((tab) =>
      tabId ? tab.tabId === tabId : tab.path === filePath
    )
    flushPendingEditorScene(requestedTab?.tabId)
    const snapshot = get()
    const sourceTab = snapshot.openTabs.find((tab) =>
      tabId ? tab.tabId === tabId : tab.path === filePath
    )
    if (!sourceTab) {
      return null
    }

    let destination: string | null
    try {
      destination = await invoke<string | null>('select_save_file_path')
    } catch (error) {
      console.error('[saveTabAs] Failed to select destination:', error)
      alert(`Failed to select a save destination: ${error}`)
      return null
    }
    if (!destination) {
      return null
    }
    if (
      forbiddenDirectory &&
      isPathInsideDirectory(destination, forbiddenDirectory)
    ) {
      alert('Choose a destination outside the folder being deleted.')
      return null
    }

    if (pathsEqual(sourceTab.path, destination)) {
      alert(
        sourceTab.recoveryState === 'deleted-on-disk'
          ? 'Choose a new path for this recovery copy. The deleted path will not be overwritten.'
          : sourceTab.externalConflict === 'modified-on-disk'
            ? 'Choose a new path for this conflicted drawing. The externally changed file will not be overwritten.'
          : 'Choose a different destination, or use Save to update the current drawing.'
      )
      return null
    }
    if (
      snapshot.openTabs.some(
        (tab) =>
          tab.tabId !== sourceTab.tabId &&
          pathsEqual(tab.path, destination)
      )
    ) {
      alert('That drawing is already open. Choose a different save destination.')
      return null
    }

    const currentState = get()
    if (
      currentState.openTabs.some(
        (tab) =>
          tab.tabId !== sourceTab.tabId &&
          pathsEqual(tab.path, destination)
      )
    ) {
      alert('That drawing is already open. Choose a different save destination.')
      return null
    }

    const currentBeforeWrite = currentState.openTabs.find(
      (tab) => tab.tabId === sourceTab.tabId
    )
    if (
      !currentBeforeWrite ||
      !hasSameSavableContent(currentBeforeWrite, sourceTab)
    ) {
      alert('The drawing changed while choosing a destination. Review it and try Save As again.')
      return null
    }

    const destinationKey = normalizePathForComparison(destination)
    if (saveAsDestinationClaims.has(destinationKey)) {
      alert('That save destination is already being written. Choose a different destination.')
      return null
    }
    saveAsDestinationClaims.add(destinationKey)

    const saveOperationId = get().beginSaveOperation(sourceTab.path)
    let saveOperationEnded = false
    try {
      const {
        content_hash: contentHash,
        file_identity: fileIdentity,
      } = await invoke<SaveFileResult>('save_file_as', {
        filePath: destination,
        content: sourceTab.cachedContent,
        openPaths: currentState.openTabs.map((tab) => tab.path),
        sourcePath: sourceTab.path,
        isRecovery: sourceTab.recoveryState === 'deleted-on-disk',
        ...(forbiddenDirectory ? { forbiddenDirectory } : {}),
      })
      const currentAfterWrite = get().openTabs.find(
        (tab) => tab.tabId === sourceTab.tabId
      )
      if (
        !currentAfterWrite ||
        !hasSameSavableContent(currentAfterWrite, sourceTab)
      ) {
        alert('The drawing changed while the copy was being saved. The latest changes remain open.')
        return null
      }

      const applied = get().applySaveAsResult(
        sourceTab.path,
        destination,
        sourceTab.cachedContent,
        contentHash,
        fileIdentity,
        saveOperationId,
        sourceTab.tabId
      )
      if (!applied) {
        alert('The saved destination could not be activated because it conflicts with another open tab.')
        return null
      }

      get().endSaveOperation(saveOperationId)
      saveOperationEnded = true
      const currentDirectory = get().currentDirectory
      if (currentDirectory) {
        await get().loadFileTree(currentDirectory)
      }
      return destination
    } catch (error) {
      console.error('[saveTabAs] Failed to save copy:', error)
      alert(`Failed to save copy: ${error}`)
      return null
    } finally {
      saveAsDestinationClaims.delete(destinationKey)
      if (!saveOperationEnded) {
        get().endSaveOperation(saveOperationId)
      }
    }
  },

  saveTabForWorkspaceResolution: async (filePath, forbiddenDirectory, tabId) => {
    const requestedTab = get().openTabs.find((tab) =>
      tabId ? tab.tabId === tabId : tab.path === filePath
    )
    flushPendingEditorScene(requestedTab?.tabId)
    const snapshot = get()
    const tab = snapshot.openTabs.find((openTab) =>
      tabId ? openTab.tabId === tabId : openTab.path === filePath
    )
    if (!tab) {
      return true
    }
    if (
      tab.recoveryState === 'deleted-on-disk' ||
      tab.externalConflict === 'modified-on-disk'
    ) {
      return Boolean(
        await get().saveTabAs(tab.path, forbiddenDirectory, tab.tabId)
      )
    }
    if (
      (
        snapshot.activeFile?.tabId
          ? snapshot.activeFile.tabId === tab.tabId
          : snapshot.activeFile?.path === tab.path
      ) &&
      snapshot.fileContent !== tab.cachedContent
    ) {
      alert('The active drawing changed before it could be saved. Review it and try again.')
      return false
    }

    const saveOperationId = get().beginSaveOperation(tab.path)
    try {
      return await serializeFileOperation(tab.path, async () => {
        const beforeWrite = get()
        const beforeWriteTab = beforeWrite.openTabs.find(
          (openTab) => openTab.tabId === tab.tabId
        )
        const activeContentChanged =
          (
            beforeWrite.activeFile?.tabId
              ? beforeWrite.activeFile.tabId === tab.tabId
              : beforeWrite.activeFile?.path === tab.path
          ) &&
          beforeWrite.fileContent !== tab.cachedContent
        if (
          !beforeWriteTab ||
          !hasSameSavableContent(beforeWriteTab, tab) ||
          activeContentChanged
        ) {
          alert('The drawing changed while waiting to be saved. Review it and try again.')
          return false
        }

        const {
          content_hash: contentHash,
          file_identity: fileIdentity,
        } = await invoke<SaveFileResult>('save_file', {
          filePath: tab.path,
          content: tab.cachedContent,
          expectedHash: beforeWriteTab.contentHash,
          expectedIdentity: beforeWriteTab.fileIdentity,
        })
        const afterWrite = get()
        const afterWriteTab = afterWrite.openTabs.find(
          (openTab) => openTab.tabId === tab.tabId
        )
        const contentChanged =
          !afterWriteTab ||
          !hasSameTabSnapshot(afterWriteTab, beforeWriteTab) ||
          ((
            afterWrite.activeFile?.tabId
              ? afterWrite.activeFile.tabId === tab.tabId
              : afterWrite.activeFile?.path === tab.path
          ) &&
            afterWrite.fileContent !== tab.cachedContent)
        if (contentChanged) {
          const currentTab = get().openTabs.find(
            (openTab) => openTab.tabId === tab.tabId
          )
          if (
            currentTab &&
            retainsDiskBaseline(currentTab, beforeWriteTab)
          ) {
            set((state) => ({
              openTabs: state.openTabs.map((openTab) =>
                openTab.tabId === currentTab.tabId
                  ? { ...openTab, contentHash, fileIdentity }
                  : openTab
              ),
            }))
          }
          if (currentTab && isUnsavedTab(currentTab)) {
            get().markTreeNodeAsModified(currentTab.path, true)
          }
          alert('The drawing changed while it was being saved. Review it and try again.')
          return false
        }

        set((state) => ({
          activeFile:
            state.activeFile && (
              state.activeFile?.tabId
                ? state.activeFile.tabId === tab.tabId
                : state.activeFile?.path === tab.path
            )
              ? { ...state.activeFile, modified: false }
              : state.activeFile,
          isDirty:
            (
              state.activeFile?.tabId
                ? state.activeFile.tabId === tab.tabId
                : state.activeFile?.path === tab.path
            )
              ? false
              : state.isDirty,
          openTabs: state.openTabs.map((openTab) =>
            openTab.tabId === tab.tabId
              ? {
                  ...openTab,
                  contentHash,
                  fileIdentity,
                  modified: false,
                  recoveryState: undefined,
                  externalConflict: undefined,
                }
              : openTab
          ),
        }))
        get().markTreeNodeAsModified(tab.path, false)
        return true
      })
    } catch (error) {
      console.error('[saveTabForWorkspaceResolution] Failed to save tab:', error)
      alert(`Failed to save drawing: ${error}`)
      return false
    } finally {
      get().endSaveOperation(saveOperationId)
    }
  },

  resolveUnsavedTabsBeforeWorkspaceChange: async () => {
    return resolveScopedUnsavedTabs(
      () => get().openTabs,
      () => true,
      'switching workspaces',
      (tab) => get().saveTabForWorkspaceResolution(
        tab.path,
        undefined,
        tab.tabId
      )
    )
  },

  // Create new file
  createNewFile: async (fileName, directory) => {
    const state = get()
    let { currentDirectory } = state

    // Check if current file has unsaved changes
    if (state.isDirty && state.activeFile) {
      const decision = await confirmUnsavedChanges(state.activeFile.name, 'creating a new file')

      if (decision === 'save') {
        await state.saveCurrentFile()
      } else if (decision === 'cancel') {
        return
      } else {
        try {
          const existingTab = get().openTabs.find((tab) =>
            state.activeFile?.tabId
              ? tab.tabId === state.activeFile.tabId
              : tab.path === state.activeFile?.path
          )
          if (existingTab?.recoveryState === 'deleted-on-disk') {
            set((currentState) => ({
              activeFile: null,
              fileContent: null,
              activeFileLoadSource: null,
              isDirty: false,
              openTabs: currentState.openTabs.filter(
                (tab) => tab.tabId !== existingTab.tabId
              ),
            }))
          } else {
            const cleanTab = await readOpenTabFromDisk(
              state.activeFile,
              (existingTab?.sceneVersion || 0) + 1
            )

            set((currentState) => ({
              activeFile: toExcalidrawFile(cleanTab),
              fileContent: cleanTab.cachedContent,
              activeFileLoadSource: 'disk',
              isDirty: false,
              openTabs: currentState.openTabs.map((tab) =>
                tab.tabId === cleanTab.tabId ? cleanTab : tab
              ),
            }))
            state.markFileAsModified(cleanTab.path, false, cleanTab.tabId)
            state.markTreeNodeAsModified(cleanTab.path, false)
          }
        } catch (error) {
          console.error('Failed to discard unsaved changes:', error)
          alert(`Failed to discard unsaved changes: ${error}`)
          return
        }
      }
    }

    // Check if a directory is selected
    if (!currentDirectory) {
      // Prompt to select a directory if none is selected
      try {
        const dir = await invoke<string | null>('select_directory')
        if (!dir) {
          return
        }
        // Load the selected directory
        await state.loadDirectory(dir)
        currentDirectory = dir
      } catch (error) {
        console.error('Failed to select directory:', error)
        alert(`Failed to select directory: ${error}`)
        return
      }
    }

    // Generate default filename if not provided
    const finalFileName = fileName || `Untitled-${Date.now()}.excalidraw`
    const requestedFileName = finalFileName.endsWith('.excalidraw')
      ? finalFileName
      : `${finalFileName}.excalidraw`
    const targetDirectory = directory || currentDirectory

    try {
      // Create the new file
      const filePath = await invoke<string>('create_new_file', {
        directory: targetDirectory,
        fileName: requestedFileName,
      })

      // Reload the file tree to show the new file
      await state.loadFileTree(currentDirectory)

      // Create an ExcalidrawFile object for the new file
      const file: ExcalidrawFile = {
        name: pathBasename(filePath),
        path: filePath,
        modified: false,
      }

      // Load the new file immediately
      await state.loadFile(file)
    } catch (error) {
      console.error('Failed to create new file:', error)
      alert(`Failed to create file: ${error}`)
    }
  },

  // Create new folder
  createNewFolder: async (folderName, directory) => {
    const state = get()
    let { currentDirectory } = state

    // Check if a directory is selected
    if (!currentDirectory) {
      // Prompt to select a directory if none is selected
      try {
        const dir = await invoke<string | null>('select_directory')
        if (!dir) {
          return
        }
        // Load the selected directory
        await state.loadDirectory(dir)
        currentDirectory = dir
      } catch (error) {
        console.error('[createNewFolder] Failed to select directory:', error)
        alert(`Failed to select directory: ${error}`)
        return
      }
    }

    // Generate default folder name if not provided
    const finalFolderName = folderName || `New Folder-${Date.now()}`
    const targetDirectory = directory || currentDirectory

    try {
      await invoke<string>('create_new_folder', {
        directory: targetDirectory,
        folderName: finalFolderName,
      })

      // Reload the file tree to show the new folder
      await state.loadFileTree(currentDirectory)
    } catch (error) {
      console.error('[createNewFolder] Failed to create folder:', error)
      alert(`Failed to create folder: ${error}`)
    }
  },

  // Rename file
  renameFile: async (oldPath, newName) => {
    try {
      // Ensure the new name has .excalidraw extension
      const finalName = newName.endsWith('.excalidraw')
        ? newName
        : `${newName}.excalidraw`

      const newPath = await invoke<string>('rename_file', {
        oldPath,
        newName: finalName,
      })

      const state = get()
      const renamedFile = state.activeFile?.path === oldPath
        ? {
            ...state.activeFile,
            name: finalName,
            path: newPath,
            modified: state.isDirty,
          }
        : null

      set({
        activeFile: renamedFile ?? state.activeFile,
        openTabs: state.openTabs.map((tab) =>
          tab.path === oldPath
            ? {
                ...tab,
                name: finalName,
                path: newPath,
                lifecycleVersion: nextLifecycleVersion(tab),
              }
            : tab
        ),
      })

      // Reload the file tree
      if (state.currentDirectory) {
        await state.loadFileTree(state.currentDirectory)
      }
    } catch (error) {
      console.error('Failed to rename file:', error)
      alert(`Failed to rename file: ${error}`)
    }
  },

  // Rename folder
  renameFolder: async (oldPath, newName) => {
    try {
      const newPath = await invoke<string>('rename_folder', {
        oldPath,
        newName,
      })

      const state = get()
      const updatedTabs = state.openTabs.map((tab) => {
        if (!isPathInsideDirectory(tab.path, oldPath)) {
          return tab
        }

        const nextPath = replacePathPrefix(tab.path, oldPath, newPath)
        return {
          ...tab,
          path: nextPath,
          name: pathBasename(nextPath),
          lifecycleVersion: nextLifecycleVersion(tab),
        }
      })

      const activeFile = state.activeFile && isPathInsideDirectory(state.activeFile.path, oldPath)
        ? {
            ...state.activeFile,
            path: replacePathPrefix(state.activeFile.path, oldPath, newPath),
            name: pathBasename(replacePathPrefix(state.activeFile.path, oldPath, newPath)),
          }
        : state.activeFile

      set({
        activeFile,
        openTabs: updatedTabs,
      })

      if (state.currentDirectory) {
        await state.loadFileTree(state.currentDirectory)
      }
    } catch (error) {
      console.error('Failed to rename folder:', error)
      alert(`Failed to rename folder: ${error}`)
    }
  },

  // Delete file
  // NOTE: Confirmation should be handled by the caller
  deleteFile: async (filePath) => {
    try {
      const deletionScope = await resolveDeletionPreflight(
        () => get().openTabs,
        filePath,
        false,
        'deleting this file',
        (tab) => get().saveTabForWorkspaceResolution(
          tab.path,
          undefined,
          tab.tabId
        )
      )
      if (!deletionScope) {
        return false
      }

      const snapshot = get()
      const affectedTabIds = deletionScope.tabIds
      const activeTabIsAffected = Boolean(
        snapshot.activeFile?.tabId &&
        affectedTabIds.has(snapshot.activeFile.tabId)
      )
      const removedTabIndex = activeTabIsAffected
        ? snapshot.openTabs.findIndex(
            (tab) => tab.tabId === snapshot.activeFile?.tabId
          )
        : snapshot.openTabs.findIndex((tab) => affectedTabIds.has(tab.tabId))
      const snapshotTabs = snapshot.openTabs.filter(
        (tab) => !affectedTabIds.has(tab.tabId)
      )
      const fallbackSnapshot = activeTabIsAffected
        ? snapshotTabs[Math.min(Math.max(removedTabIndex, 0), snapshotTabs.length - 1)]
        : undefined
      let preparedFallback: PreparedFallbackTab | null = null

      if (fallbackSnapshot) {
        try {
          preparedFallback = await prepareFallbackTab(fallbackSnapshot)
        } catch (error) {
          console.error('[deleteFile] Failed to validate fallback tab:', error)
        }
      }

      const currentScope = await getStableDeletionScope(
        () => get().openTabs,
        filePath,
        false
      )
      const scopeChanged =
        currentScope.tabIds.size !== affectedTabIds.size ||
        [...affectedTabIds].some((tabId) => !currentScope.tabIds.has(tabId))
      if (
        scopeChanged ||
        !haveSameScopedTabs(
          snapshot.openTabs,
          currentScope.tabs,
          (tab) => affectedTabIds.has(tab.tabId)
        )
      ) {
        throw new Error('The drawing changed while deletion was pending. Review it and try again.')
      }

      await invoke('delete_file', { filePath })
      if (fallbackSnapshot && !fallbackSnapshot.modified) {
        try {
          preparedFallback = await revalidateCleanFallbackAfterDelete(
            fallbackSnapshot,
            get().openTabs
          )
        } catch (error) {
          preparedFallback = null
          console.error('[deleteFile] Failed to revalidate fallback tab:', error)
        }
      }

      let fallbackActivationBlocked = false
      let recoveryRequired = false
      set((currentState) => {
        const recoveryState = reconcilePostDeleteRecovery(
          currentState,
          snapshot.openTabs,
          (tab) => affectedTabIds.has(tab.tabId)
        )
        if (recoveryState) {
          recoveryRequired = true
          return recoveryState
        }

        const openTabs = currentState.openTabs.filter(
          (tab) => !affectedTabIds.has(tab.tabId)
        )

        if (
          !currentState.activeFile?.tabId ||
          !affectedTabIds.has(currentState.activeFile.tabId)
        ) {
          return { openTabs }
        }

        const fallback = resolveFallbackTab(
          openTabs,
          removedTabIndex,
          fallbackSnapshot,
          preparedFallback
        )
        fallbackActivationBlocked = fallback.activationBlocked
        if (!fallback.fallbackTab) {
          return {
            openTabs: fallback.openTabs,
            activeFile: null,
            fileContent: null,
            activeFileLoadSource: null,
            isDirty: false,
          }
        }

        return {
          openTabs: fallback.openTabs,
          activeFile: toExcalidrawFile(fallback.fallbackTab),
          fileContent: fallback.fallbackTab.cachedContent,
          activeFileLoadSource: fallback.source,
          isDirty: fallback.fallbackTab.modified,
        }
      })

      const currentDirectory = get().currentDirectory
      if (currentDirectory) {
        await get().loadFileTree(currentDirectory)
      }

      if (recoveryRequired) {
        throw new DeletionRecoveryError(
          'The drawing was deleted on disk, but edits made during deletion remain open as a recovery copy.'
        )
      }

      if (fallbackActivationBlocked) {
        throw new DeletionFallbackValidationError(
          'The drawing was deleted, but the next tab could not be validated against disk and was left inactive.'
        )
      }

      return true
    } catch (error) {
      if (
        error instanceof DeletionFallbackValidationError ||
        error instanceof DeletionRecoveryError
      ) {
        console.error('[deleteFile] Deleted with recovery warning:', error)
      } else {
        console.error('[deleteFile] Failed to delete file:', error)
      }
      throw error
    }
  },

  // Delete folder
  // NOTE: Confirmation should be handled by the caller
  deleteFolder: async (folderPath) => {
    try {
      const deletionScope = await resolveDeletionPreflight(
        () => get().openTabs,
        folderPath,
        true,
        'deleting this folder',
        (tab) => get().saveTabForWorkspaceResolution(
          tab.path,
          folderPath,
          tab.tabId
        )
      )
      if (!deletionScope) {
        return false
      }

      const snapshot = get()
      const affectedTabIds = deletionScope.tabIds
      const activeTabIsAffected = Boolean(
        snapshot.activeFile?.tabId &&
        affectedTabIds.has(snapshot.activeFile.tabId)
      )
      const activeTabIndex = activeTabIsAffected
        ? snapshot.openTabs.findIndex(
            (tab) => tab.tabId === snapshot.activeFile?.tabId
          )
        : snapshot.openTabs.findIndex((tab) => affectedTabIds.has(tab.tabId))
      const snapshotTabs = snapshot.openTabs.filter(
        (tab) => !affectedTabIds.has(tab.tabId)
      )
      const fallbackSnapshot = activeTabIsAffected
        ? snapshotTabs[Math.min(Math.max(activeTabIndex, 0), snapshotTabs.length - 1)]
        : undefined
      let preparedFallback: PreparedFallbackTab | null = null

      if (fallbackSnapshot) {
        try {
          preparedFallback = await prepareFallbackTab(fallbackSnapshot)
        } catch (error) {
          console.error('[deleteFolder] Failed to validate fallback tab:', error)
        }
      }

      const currentScope = await getStableDeletionScope(
        () => get().openTabs,
        folderPath,
        true
      )
      const scopeChanged =
        currentScope.tabIds.size !== affectedTabIds.size ||
        [...affectedTabIds].some((tabId) => !currentScope.tabIds.has(tabId))
      if (
        scopeChanged ||
        !haveSameScopedTabs(
          snapshot.openTabs,
          currentScope.tabs,
          (tab) => affectedTabIds.has(tab.tabId)
        )
      ) {
        throw new Error('The folder contents changed while deletion was pending. Review them and try again.')
      }

      await invoke('delete_folder', { folderPath })
      if (fallbackSnapshot && !fallbackSnapshot.modified) {
        try {
          preparedFallback = await revalidateCleanFallbackAfterDelete(
            fallbackSnapshot,
            get().openTabs
          )
        } catch (error) {
          preparedFallback = null
          console.error('[deleteFolder] Failed to revalidate fallback tab:', error)
        }
      }

      let fallbackActivationBlocked = false
      let recoveryRequired = false
      set((currentState) => {
        const recoveryState = reconcilePostDeleteRecovery(
          currentState,
          snapshot.openTabs,
          (tab) => affectedTabIds.has(tab.tabId)
        )
        if (recoveryState) {
          recoveryRequired = true
          return recoveryState
        }

        const openTabs = currentState.openTabs.filter(
          (tab) => !affectedTabIds.has(tab.tabId)
        )

        if (
          !currentState.activeFile?.tabId ||
          !affectedTabIds.has(currentState.activeFile.tabId)
        ) {
          return { openTabs }
        }

        const fallback = resolveFallbackTab(
          openTabs,
          activeTabIndex,
          fallbackSnapshot,
          preparedFallback
        )
        fallbackActivationBlocked = fallback.activationBlocked
        if (!fallback.fallbackTab) {
          return {
            openTabs: fallback.openTabs,
            activeFile: null,
            fileContent: null,
            activeFileLoadSource: null,
            isDirty: false,
          }
        }

        return {
          openTabs: fallback.openTabs,
          activeFile: toExcalidrawFile(fallback.fallbackTab),
          fileContent: fallback.fallbackTab.cachedContent,
          activeFileLoadSource: fallback.source,
          isDirty: fallback.fallbackTab.modified,
        }
      })

      const currentDirectory = get().currentDirectory
      if (currentDirectory) {
        await get().loadFileTree(currentDirectory)
      }

      if (recoveryRequired) {
        throw new DeletionRecoveryError(
          'The folder was deleted on disk, but edits made during deletion remain open as recovery copies.'
        )
      }

      if (fallbackActivationBlocked) {
        throw new DeletionFallbackValidationError(
          'The folder was deleted, but the next tab could not be validated against disk and was left inactive.'
        )
      }

      return true
    } catch (error) {
      if (
        error instanceof DeletionFallbackValidationError ||
        error instanceof DeletionRecoveryError
      ) {
        console.error('[deleteFolder] Deleted with recovery warning:', error)
      } else {
        console.error('[deleteFolder] Failed to delete folder:', error)
      }
      throw error
    }
  },

  // Load preferences
  loadPreferences: async () => {
    try {
      // The Rust backend returns snake_case fields
      const prefs = await invoke<any>('get_preferences')

      // Convert snake_case from Rust to camelCase for TypeScript
      const safePrefs = convertPreferencesFromRust(prefs)

      set({
        preferences: safePrefs,
        sidebarVisible: safePrefs.sidebarVisible,
      })

      // Apply decorations preference
      if (safePrefs.showDecorations === false) {
        invoke('set_decorations', { visible: false })
      }

      // Auto-load last directory if it exists
      if (safePrefs.lastDirectory) {
        try {
          await get().loadDirectory(safePrefs.lastDirectory)
        } catch (dirError) {
          console.error('Failed to auto-load last directory:', dirError)
          // Clear the invalid lastDirectory from preferences
          const newPrefs = { ...safePrefs, lastDirectory: null }
          set({ preferences: newPrefs })
          await get().savePreferences()
        }
      }
    } catch (error) {
      console.error('Failed to load preferences:', error)
      // Set default preferences if loading fails
      const defaultPrefs: Preferences = {
        lastDirectory: null,
        recentDirectories: [],
        theme: 'system',
        sidebarVisible: true,
        sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
        showDecorations: true,
      }
      set({
        preferences: defaultPrefs,
        sidebarVisible: true,
      })
    }
  },

  // Save preferences
  savePreferences: async () => {
    const { preferences } = get()
    try {
      // Convert camelCase to snake_case for Rust backend
      const prefsToSave = convertPreferencesToRust(preferences)
      await invoke('save_preferences', { preferences: prefsToSave })
    } catch (error) {
      console.error('Failed to save preferences:', error)
    }
  },

  // Toggle sidebar
  toggleSidebar: () => {
    const state = get()
    const newVisible = !state.sidebarVisible
    set({ sidebarVisible: newVisible })

    // Update preferences
    const newPrefs = { ...state.preferences, sidebarVisible: newVisible }
    set({ preferences: newPrefs })
    state.savePreferences()
  },

  // Toggle presentation mode
  togglePresentationMode: () => {
    const state = get()
    const entering = !state.presentationMode
    set({ presentationMode: entering })

    if (entering) {
      invoke('set_menu_visible', { visible: false }).catch((error) => {
        console.error('Failed to hide menu for presentation mode:', error)
        set({ presentationMode: false })
      })
    } else {
      if (state.preferences.showDecorations) {
        invoke('set_menu_visible', { visible: true }).catch((error) => {
          console.error('Failed to restore menu after presentation mode:', error)
        })
      }
    }
  },

  // Close tab
  closeTab: async (filePath, tabId) => {
    const state = get()
    const tabIndex = state.openTabs.findIndex((tab) =>
      tabId ? tab.tabId === tabId : tab.path === filePath
    )
    if (tabIndex === -1) return

    const tab = state.openTabs[tabIndex]

    const isActiveTab = state.activeFile?.tabId
      ? state.activeFile.tabId === tab.tabId
      : state.activeFile?.path === filePath
    const needsConfirmation = isUnsavedTab(tab) || (isActiveTab && state.isDirty)

    if (needsConfirmation) {
      const decision = await confirmUnsavedChanges(tab.name, 'closing')

      if (decision === 'save') {
        if (
          tab.recoveryState === 'deleted-on-disk' ||
          tab.externalConflict === 'modified-on-disk'
        ) {
          const savedPath = await state.saveTabAs(
            tab.path,
            undefined,
            tab.tabId
          )
          if (!savedPath) {
            return
          }
        } else if (!isActiveTab) {
          const saved = await state.saveTabForWorkspaceResolution(
            tab.path,
            undefined,
            tab.tabId
          )
          if (!saved) {
            return
          }
        } else {
          const saved = await state.saveCurrentFile()
          if (!saved) {
            return
          }
        }
      } else if (decision === 'cancel') {
        return
      } else if (isActiveTab) {
        set((currentState) => ({
          isDirty: false,
          activeFile: currentState.activeFile
            ? { ...currentState.activeFile, modified: false }
            : null,
        }))
      }
    }

    const newTabs = get().openTabs.filter(
      (openTab) => openTab.tabId !== tab.tabId
    )

    if (
      get().activeFile?.tabId
        ? get().activeFile?.tabId === tab.tabId
        : get().activeFile?.path === tab.path
    ) {
      // Switch to adjacent tab
      if (newTabs.length > 0) {
        const newIndex = Math.min(tabIndex, newTabs.length - 1)
        const newActiveTab = newTabs[newIndex]
        set({ openTabs: newTabs })
        await get().loadFile(newActiveTab)
      } else {
        set({
          openTabs: newTabs,
          activeFile: null,
          fileContent: null,
          activeFileLoadSource: null,
          isDirty: false,
        })
      }
    } else {
      set({ openTabs: newTabs })
    }
  },

}))
