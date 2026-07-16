import path from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import { z } from 'zod'
import {
  BrowserWindow,
  dialog,
  ipcMain,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type Rectangle,
} from 'electron'
import type {
  AskDialogOptions,
  MessageDialogOptions,
  ResizeDirection,
  SaveFileAsRequest,
  SaveFileRequest,
} from '../src/lib/native'
import type { Preferences } from '../src/types'
import { IPC } from './channels'
import {
  createNewFile,
  createNewFolder,
  deleteFile,
  deleteFolder,
  getDeletionScopeMatches,
  getFileTree,
  listDocumentFiles,
  readDocumentFile,
  renameFile,
  renameFolder,
  saveDocumentFile,
  saveDocumentFileAs,
} from './filesystem'
import { setApplicationMenu } from './menu'
import { PreferencesStore } from './preferences'
import {
  absolutePathSchema,
  askDialogSchema,
  coordinateSchema,
  messageDialogSchema,
  nameSchema,
  preferencesSchema,
  resizeDirectionSchema,
  saveFileAsSchema,
  saveFileSchema,
} from './validation'
import {
  DOCUMENT_KINDS,
  documentKindFromPath,
  ensureDocumentExtension,
  type DocumentKind,
} from '../src/lib/documentKind'

interface ResizeSession {
  direction: ResizeDirection
  startX: number
  startY: number
  bounds: Rectangle
}

export interface NativeServices {
  getWindow(): BrowserWindow | null
  isTrustedFrameUrl(url: string): boolean
  preferences: PreferencesStore
  forceClose(): void
  cancelClose(): void
}

let watcher: FSWatcher | null = null
let watchGeneration = 0
let resizeSession: ResizeSession | null = null

function requireWindow(services: NativeServices): BrowserWindow {
  const window = services.getWindow()
  if (!window || window.isDestroyed()) {
    throw new Error('The application window is unavailable')
  }
  return window
}

function assertTrustedSender(
  event: IpcMainInvokeEvent | IpcMainEvent,
  services: NativeServices
): void {
  if (event.sender !== requireWindow(services).webContents) {
    throw new Error('Rejected IPC from an untrusted renderer')
  }
  const mainFrame = event.sender.mainFrame
  if (
    event.senderFrame !== mainFrame ||
    !services.isTrustedFrameUrl(event.senderFrame.url)
  ) {
    throw new Error('Rejected IPC from an untrusted frame')
  }
}

function handle<T extends unknown[], R>(
  channel: string,
  services: NativeServices,
  handler: (...args: T) => Promise<R> | R
): void {
  ipcMain.handle(channel, async (event, ...args: T) => {
    assertTrustedSender(event, services)
    return handler(...args)
  })
}

async function watchDirectory(directory: string, services: NativeServices): Promise<void> {
  const generation = ++watchGeneration
  await watcher?.close()
  const nextWatcher = chokidar.watch(directory, {
    ignoreInitial: true,
    followSymlinks: false,
  })
  watcher = nextWatcher
  const emitChange = (changedPath: string) => {
    if (
      generation === watchGeneration &&
      documentKindFromPath(changedPath) !== null
    ) {
      requireWindow(services).webContents.send(
        IPC.eventFileSystemChange,
        changedPath
      )
    }
  }
  nextWatcher.on('add', emitChange)
  nextWatcher.on('change', emitChange)
  nextWatcher.on('unlink', emitChange)
  await new Promise<void>((resolve, reject) => {
    nextWatcher.once('ready', resolve)
    nextWatcher.once('error', reject)
  })
}

function resizeBounds(session: ResizeSession, screenX: number, screenY: number): Rectangle {
  const minimumWidth = 1200
  const minimumHeight = 700
  const deltaX = screenX - session.startX
  const deltaY = screenY - session.startY
  const next = { ...session.bounds }

  if (session.direction.includes('East')) {
    next.width = Math.max(minimumWidth, session.bounds.width + deltaX)
  }
  if (session.direction.includes('South')) {
    next.height = Math.max(minimumHeight, session.bounds.height + deltaY)
  }
  if (session.direction.includes('West')) {
    next.width = Math.max(minimumWidth, session.bounds.width - deltaX)
    next.x = session.bounds.x + session.bounds.width - next.width
  }
  if (session.direction.includes('North')) {
    next.height = Math.max(minimumHeight, session.bounds.height - deltaY)
    next.y = session.bounds.y + session.bounds.height - next.height
  }
  return next
}

export function registerNativeIpc(services: NativeServices): void {
  handle(IPC.workspaceSelectDirectory, services, async () => {
    if (
      process.env.RACHANA_E2E === '1' &&
      process.env.RACHANA_TEST_DIRECTORY
    ) {
      return absolutePathSchema.parse(process.env.RACHANA_TEST_DIRECTORY)
    }
    const result = await dialog.showOpenDialog(requireWindow(services), {
      properties: ['openDirectory', 'createDirectory'],
    })
    return result.canceled ? null : result.filePaths[0] ?? null
  })
  handle(IPC.workspaceListFiles, services, (directory: string) =>
    listDocumentFiles(absolutePathSchema.parse(directory))
  )
  handle(IPC.workspaceGetFileTree, services, (directory: string) =>
    getFileTree(absolutePathSchema.parse(directory))
  )
  handle(IPC.workspaceWatch, services, (directory: string) =>
    watchDirectory(absolutePathSchema.parse(directory), services)
  )
  handle(
    IPC.workspaceDeletionScope,
    services,
    (targetPath: string, isDirectory: boolean, candidatePaths: string[]) =>
      getDeletionScopeMatches(
        absolutePathSchema.parse(targetPath),
        z.boolean().parse(isDirectory),
        z.array(absolutePathSchema).parse(candidatePaths)
      )
  )
  handle(IPC.workspaceCreateFile, services, (
    directory: string,
    fileName: string,
    kind: DocumentKind
  ) =>
    createNewFile(
      absolutePathSchema.parse(directory),
      nameSchema.parse(fileName),
      z.enum(DOCUMENT_KINDS).parse(kind)
    )
  )
  handle(IPC.workspaceCreateFolder, services, (directory: string, folderName: string) =>
    createNewFolder(absolutePathSchema.parse(directory), nameSchema.parse(folderName))
  )
  handle(IPC.workspaceRenameFile, services, (oldPath: string, newName: string) =>
    renameFile(absolutePathSchema.parse(oldPath), nameSchema.parse(newName))
  )
  handle(IPC.workspaceRenameFolder, services, (oldPath: string, newName: string) =>
    renameFolder(absolutePathSchema.parse(oldPath), nameSchema.parse(newName))
  )
  handle(IPC.workspaceDeleteFile, services, (filePath: string) =>
    deleteFile(absolutePathSchema.parse(filePath))
  )
  handle(IPC.workspaceDeleteFolder, services, (folderPath: string) =>
    deleteFolder(absolutePathSchema.parse(folderPath))
  )
  handle(IPC.filesRead, services, (filePath: string) =>
    readDocumentFile(absolutePathSchema.parse(filePath))
  )
  handle(IPC.filesSave, services, (request: SaveFileRequest) =>
    saveDocumentFile(saveFileSchema.parse(request))
  )
  handle(IPC.filesSelectSavePath, services, async (kind: DocumentKind) => {
    const validatedKind = z.enum(DOCUMENT_KINDS).parse(kind)
    const result = await dialog.showSaveDialog(requireWindow(services), {
      title: 'Save As',
      filters: validatedKind === 'markdown'
        ? [{ name: 'Markdown', extensions: ['md', 'markdown'] }]
        : [{ name: 'Excalidraw', extensions: ['excalidraw'] }],
    })
    return result.canceled || !result.filePath
      ? null
      : ensureDocumentExtension(result.filePath, validatedKind)
  })
  handle(IPC.filesSaveAs, services, (request: SaveFileAsRequest) =>
    saveDocumentFileAs(saveFileAsSchema.parse(request))
  )
  handle(IPC.preferencesGet, services, () => services.preferences.get())
  handle(IPC.preferencesSave, services, async (preferences: Preferences) => {
    const validatedPreferences = preferencesSchema.parse(preferences)
    await services.preferences.save(validatedPreferences)
    setApplicationMenu(requireWindow(services), validatedPreferences)
  })
  handle(
    IPC.dialogAsk,
    services,
    async (message: string, options: AskDialogOptions) => {
      const validatedOptions = askDialogSchema.parse(options)
      const result = await dialog.showMessageBox(requireWindow(services), {
        type: validatedOptions.kind,
        title: validatedOptions.title,
        message: z.string().max(10_000).parse(message),
        buttons: [validatedOptions.okLabel, validatedOptions.cancelLabel],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      })
      return result.response === 0
    }
  )
  handle(
    IPC.dialogMessage,
    services,
    async (message: string, options: MessageDialogOptions) => {
      const validatedOptions = messageDialogSchema.parse(options)
      await dialog.showMessageBox(requireWindow(services), {
        type: validatedOptions.kind,
        title: validatedOptions.title,
        message: z.string().max(10_000).parse(message),
        buttons: ['OK'],
        noLink: true,
      })
    }
  )
  handle(IPC.windowClose, services, () => requireWindow(services).close())
  handle(IPC.windowMinimize, services, () => requireWindow(services).minimize())
  handle(IPC.windowToggleMaximize, services, () => {
    const window = requireWindow(services)
    window.isMaximized() ? window.unmaximize() : window.maximize()
  })
  handle(IPC.windowIsMaximized, services, () => requireWindow(services).isMaximized())
  handle(IPC.windowIsFullscreen, services, () => requireWindow(services).isFullScreen())
  handle(IPC.windowSetFullscreen, services, (fullscreen: boolean) =>
    requireWindow(services).setFullScreen(z.boolean().parse(fullscreen))
  )
  handle(IPC.windowSetMenuVisible, services, async (visible: boolean) => {
    setApplicationMenu(
      requireWindow(services),
      await services.preferences.get(),
      z.boolean().parse(visible)
    )
  })
  handle(IPC.appForceClose, services, () => services.forceClose())
  handle(IPC.appCancelClose, services, () => services.cancelClose())

  const safeResizeListener = (
    listener: (event: IpcMainEvent, ...args: unknown[]) => void
  ) => (event: IpcMainEvent, ...args: unknown[]) => {
    try {
      listener(event, ...args)
    } catch (error) {
      console.error('Rejected invalid resize IPC:', error)
      resizeSession = null
    }
  }

  ipcMain.on(
    IPC.windowBeginResize,
    safeResizeListener((event, direction, screenX, screenY) => {
      assertTrustedSender(event, services)
      const validatedDirection = resizeDirectionSchema.parse(direction)
      const validatedX = coordinateSchema.parse(screenX)
      const validatedY = coordinateSchema.parse(screenY)
      const window = requireWindow(services)
      if (!window.isMaximized()) {
        resizeSession = {
          direction: validatedDirection,
          startX: validatedX,
          startY: validatedY,
          bounds: window.getBounds(),
        }
      }
    })
  )
  ipcMain.on(IPC.windowUpdateResize, safeResizeListener((event, screenX, screenY) => {
    assertTrustedSender(event, services)
    if (resizeSession) {
      requireWindow(services).setBounds(
        resizeBounds(
          resizeSession,
          coordinateSchema.parse(screenX),
          coordinateSchema.parse(screenY)
        ),
        false
      )
    }
  }))
  ipcMain.on(IPC.windowEndResize, safeResizeListener((event) => {
    assertTrustedSender(event, services)
    resizeSession = null
  }))
}

export async function stopNativeServices(): Promise<void> {
  watchGeneration += 1
  await watcher?.close()
  watcher = null
}