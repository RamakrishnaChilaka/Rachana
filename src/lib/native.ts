import type { DocumentFile, FileTreeNode, Preferences } from '../types'
import type { DocumentKind } from './documentKind'

export interface NativeFileContent {
  content: string
  contentHash: string
  fileIdentity: string
}

export interface NativeSaveResult {
  contentHash: string
  fileIdentity: string
}

export interface SaveFileRequest {
  filePath: string
  content: string
  expectedHash?: string
  expectedIdentity?: string
}

export interface SaveFileAsRequest {
  filePath: string
  content: string
  openPaths: string[]
  sourcePath: string
  isRecovery: boolean
  forbiddenDirectory?: string
}

export interface MenuCommand {
  command: string
  data?: {
    directory?: string
  }
}

export type DialogKind = 'info' | 'warning' | 'error'

export interface AskDialogOptions {
  title: string
  kind: DialogKind
  okLabel: string
  cancelLabel: string
}

export interface MessageDialogOptions {
  title: string
  kind: DialogKind
}

export type ResizeDirection =
  | 'East'
  | 'North'
  | 'NorthEast'
  | 'NorthWest'
  | 'South'
  | 'SouthEast'
  | 'SouthWest'
  | 'West'

export interface RachanaNativeApi {
  workspace: {
    selectDirectory(): Promise<string | null>
    listFiles(directory: string): Promise<DocumentFile[]>
    getFileTree(directory: string): Promise<FileTreeNode[]>
    watch(directory: string): Promise<void>
    getDeletionScopeMatches(
      targetPath: string,
      isDirectory: boolean,
      candidatePaths: string[]
    ): Promise<boolean[]>
    createFile(
      directory: string,
      fileName: string,
      kind: DocumentKind
    ): Promise<string>
    createFolder(directory: string, folderName: string): Promise<string>
    renameFile(oldPath: string, newName: string): Promise<string>
    renameFolder(oldPath: string, newName: string): Promise<string>
    deleteFile(filePath: string): Promise<void>
    deleteFolder(folderPath: string): Promise<void>
  }
  files: {
    read(filePath: string): Promise<NativeFileContent>
    save(request: SaveFileRequest): Promise<NativeSaveResult>
    selectSavePath(kind: DocumentKind): Promise<string | null>
    saveAs(request: SaveFileAsRequest): Promise<NativeSaveResult>
  }
  preferences: {
    get(): Promise<Preferences>
    save(preferences: Preferences): Promise<void>
  }
  dialogs: {
    ask(message: string, options: AskDialogOptions): Promise<boolean>
    message(message: string, options: MessageDialogOptions): Promise<void>
  }
  window: {
    close(): Promise<void>
    minimize(): Promise<void>
    toggleMaximize(): Promise<void>
    isMaximized(): Promise<boolean>
    isFullscreen(): Promise<boolean>
    setFullscreen(fullscreen: boolean): Promise<void>
    setMenuVisible(visible: boolean): Promise<void>
    beginResize(direction: ResizeDirection, screenX: number, screenY: number): void
    updateResize(screenX: number, screenY: number): void
    endResize(): void
    onMaximizedChange(listener: (maximized: boolean) => void): () => void
  }
  events: {
    onFileSystemChange(listener: (path: string) => void): () => void
    onCheckUnsavedBeforeClose(listener: () => void): () => void
    onMenuCommand(listener: (command: MenuCommand) => void): () => void
  }
  app: {
    forceClose(): Promise<void>
    cancelClose(): Promise<void>
  }
}

export function getNativeApi(): RachanaNativeApi {
  const nativeWindow = window as Window & {
    rachana?: RachanaNativeApi
  }
  if (!nativeWindow.rachana) {
    throw new Error('Rachana native bridge is unavailable')
  }
  return nativeWindow.rachana
}