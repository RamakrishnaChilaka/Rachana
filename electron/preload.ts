import { contextBridge, ipcRenderer } from 'electron'
import type { RachanaNativeApi } from '../src/lib/native'
import { IPC } from './channels'

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, payload: T) => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: RachanaNativeApi = {
  workspace: {
    selectDirectory: () => ipcRenderer.invoke(IPC.workspaceSelectDirectory),
    listFiles: (directory) => ipcRenderer.invoke(IPC.workspaceListFiles, directory),
    getFileTree: (directory) => ipcRenderer.invoke(IPC.workspaceGetFileTree, directory),
    watch: (directory) => ipcRenderer.invoke(IPC.workspaceWatch, directory),
    getDeletionScopeMatches: (targetPath, isDirectory, candidatePaths) =>
      ipcRenderer.invoke(
        IPC.workspaceDeletionScope,
        targetPath,
        isDirectory,
        candidatePaths
      ),
    createFile: (directory, fileName, kind) =>
      ipcRenderer.invoke(IPC.workspaceCreateFile, directory, fileName, kind),
    createFolder: (directory, folderName) =>
      ipcRenderer.invoke(IPC.workspaceCreateFolder, directory, folderName),
    renameFile: (oldPath, newName) =>
      ipcRenderer.invoke(IPC.workspaceRenameFile, oldPath, newName),
    renameFolder: (oldPath, newName) =>
      ipcRenderer.invoke(IPC.workspaceRenameFolder, oldPath, newName),
    deleteFile: (filePath) => ipcRenderer.invoke(IPC.workspaceDeleteFile, filePath),
    deleteFolder: (folderPath) => ipcRenderer.invoke(IPC.workspaceDeleteFolder, folderPath),
  },
  files: {
    read: (filePath) => ipcRenderer.invoke(IPC.filesRead, filePath),
    save: (request) => ipcRenderer.invoke(IPC.filesSave, request),
    selectSavePath: (kind) => ipcRenderer.invoke(IPC.filesSelectSavePath, kind),
    saveAs: (request) => ipcRenderer.invoke(IPC.filesSaveAs, request),
  },
  preferences: {
    get: () => ipcRenderer.invoke(IPC.preferencesGet),
    save: (preferences) => ipcRenderer.invoke(IPC.preferencesSave, preferences),
  },
  dialogs: {
    ask: (message, options) => ipcRenderer.invoke(IPC.dialogAsk, message, options),
    message: (message, options) => ipcRenderer.invoke(IPC.dialogMessage, message, options),
  },
  window: {
    close: () => ipcRenderer.invoke(IPC.windowClose),
    minimize: () => ipcRenderer.invoke(IPC.windowMinimize),
    toggleMaximize: () => ipcRenderer.invoke(IPC.windowToggleMaximize),
    isMaximized: () => ipcRenderer.invoke(IPC.windowIsMaximized),
    isFullscreen: () => ipcRenderer.invoke(IPC.windowIsFullscreen),
    setFullscreen: (fullscreen) => ipcRenderer.invoke(IPC.windowSetFullscreen, fullscreen),
    setMenuVisible: (visible) => ipcRenderer.invoke(IPC.windowSetMenuVisible, visible),
    beginResize: (direction, screenX, screenY) =>
      ipcRenderer.send(IPC.windowBeginResize, direction, screenX, screenY),
    updateResize: (screenX, screenY) =>
      ipcRenderer.send(IPC.windowUpdateResize, screenX, screenY),
    endResize: () => ipcRenderer.send(IPC.windowEndResize),
    onMaximizedChange: (listener) =>
      subscribe<boolean>(IPC.eventMaximizedChange, listener),
  },
  events: {
    onFileSystemChange: (listener) =>
      subscribe<string>(IPC.eventFileSystemChange, listener),
    onCheckUnsavedBeforeClose: (listener) =>
      subscribe<void>(IPC.eventCheckUnsavedBeforeClose, listener),
    onMenuCommand: (listener) =>
      subscribe(IPC.eventMenuCommand, listener),
  },
  app: {
    forceClose: () => ipcRenderer.invoke(IPC.appForceClose),
    cancelClose: () => ipcRenderer.invoke(IPC.appCancelClose),
  },
}

contextBridge.exposeInMainWorld('rachana', api)