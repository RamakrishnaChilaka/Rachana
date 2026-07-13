import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type {
  AppState as ExcalidrawAppState,
  BinaryFiles,
} from '@excalidraw/excalidraw/types'

export interface ExcalidrawFile {
  name: string
  path: string
  modified: boolean
  tabId?: string
}

export interface CachedExcalidrawScene {
  elements: readonly ExcalidrawElement[]
  appState: Partial<ExcalidrawAppState>
  files?: BinaryFiles
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

export interface Preferences {
  lastDirectory: string | null
  recentDirectories: string[]
  theme: 'light' | 'dark' | 'system'
  sidebarVisible: boolean
  sidebarWidth: number
  showDecorations: boolean
}
