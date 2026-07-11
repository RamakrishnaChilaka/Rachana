export interface ExcalidrawFile {
  name: string
  path: string
  modified: boolean
  tabId?: string
}

export interface CachedExcalidrawScene {
  elements: readonly any[]
  appState: Record<string, any>
  files?: Record<string, any>
}

export interface OpenTab extends ExcalidrawFile {
  tabId: string
  cachedContent: string
  contentHash: string
  fileIdentity?: string
  cachedScene: CachedExcalidrawScene
  sceneVersion: number
  recoveryState?: 'deleted-on-disk'
  externalConflict?: 'modified-on-disk'
  lifecycleVersion?: number
}

export interface FileTreeNode {
  name: string
  path: string
  is_directory: boolean
  modified: boolean
  children?: FileTreeNode[]
}

export interface AppState {
  currentDirectory: string | null
  files: ExcalidrawFile[]
  activeFile: ExcalidrawFile | null
  recentDirectories: string[]
}

export interface Preferences {
  lastDirectory: string | null
  recentDirectories: string[]
  theme: 'light' | 'dark' | 'system'
  sidebarVisible: boolean
  sidebarWidth: number
  showDecorations: boolean
}
