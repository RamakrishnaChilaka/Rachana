import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type {
  AppState as ExcalidrawAppState,
  BinaryFiles,
} from '@excalidraw/excalidraw/types'
import type { DocumentKind } from '../lib/documentKind'

export interface DocumentFile {
  name: string
  path: string
  kind: DocumentKind
  modified: boolean
  tabId?: string
}

export interface CachedExcalidrawScene {
  elements: readonly ExcalidrawElement[]
  appState: Partial<ExcalidrawAppState>
  files?: BinaryFiles
}

interface BaseOpenTab extends DocumentFile {
  tabId: string
  cachedContent: string
  contentHash: string
  fileIdentity?: string
  cachedScene?: CachedExcalidrawScene
  contentVersion: number
  recoveryState?: 'deleted-on-disk'
  externalConflict?: 'modified-on-disk'
  lifecycleVersion?: number
}

export interface ExcalidrawOpenTab extends BaseOpenTab {
  kind: 'excalidraw'
  cachedScene: CachedExcalidrawScene
}

export interface MarkdownOpenTab extends BaseOpenTab {
  kind: 'markdown'
  cachedScene?: never
}

export type OpenTab = ExcalidrawOpenTab | MarkdownOpenTab

export interface FileTreeNode {
  name: string
  path: string
  kind?: DocumentKind
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
