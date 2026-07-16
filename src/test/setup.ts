import '@testing-library/jest-dom'
import { vi, beforeEach } from 'vitest'
import type { RachanaNativeApi } from '../lib/native'

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal('ResizeObserver', TestResizeObserver)

const mockInvoke = vi.fn()
const mockOnFileSystemChange = vi.fn()
const mockOnCheckUnsavedBeforeClose = vi.fn()
const mockOnMenuCommand = vi.fn()
const mockAsk = vi.fn()
const mockMessage = vi.fn()
const mockAppWindow = {
  close: vi.fn(() => Promise.resolve()),
  minimize: vi.fn(() => Promise.resolve()),
  toggleMaximize: vi.fn(() => Promise.resolve()),
  isMaximized: vi.fn(() => Promise.resolve(false)),
  isFullscreen: vi.fn(() => Promise.resolve(false)),
  setFullscreen: vi.fn(() => Promise.resolve()),
  setMenuVisible: vi.fn(() => Promise.resolve()),
  beginResize: vi.fn(),
  updateResize: vi.fn(),
  endResize: vi.fn(),
  onMaximizedChange: vi.fn(() => vi.fn()),
}
const saveResult = (contentHash: string, fileIdentity = `identity:${contentHash}`) => ({
  content_hash: contentHash,
  file_identity: fileIdentity,
})

function normalizeFileContent(result: any) {
  return {
    content: result.content,
    contentHash: result.contentHash ?? result.content_hash,
    fileIdentity: result.fileIdentity ?? result.file_identity,
  }
}

function normalizeSaveResult(result: any) {
  return {
    contentHash: result.contentHash ?? result.content_hash,
    fileIdentity: result.fileIdentity ?? result.file_identity,
  }
}

function normalizePreferences(result: any) {
  return {
    lastDirectory: result?.lastDirectory ?? result?.last_directory ?? null,
    recentDirectories: result?.recentDirectories ?? result?.recent_directories ?? [],
    theme: result?.theme ?? 'system',
    sidebarVisible: result?.sidebarVisible ?? result?.sidebar_visible ?? true,
    sidebarWidth: result?.sidebarWidth ?? result?.sidebar_width ?? 248,
    showDecorations: result?.showDecorations ?? result?.show_decorations ?? true,
  }
}

const mockNativeApi: RachanaNativeApi = {
  workspace: {
    selectDirectory: () => mockInvoke('select_directory'),
    listFiles: (directory) => mockInvoke('list_excalidraw_files', { directory }),
    getFileTree: (directory) => mockInvoke('get_file_tree', { directory }),
    watch: (directory) => mockInvoke('watch_directory', { directory }),
    getDeletionScopeMatches: (targetPath, isDirectory, candidatePaths) =>
      mockInvoke('get_deletion_scope_matches', {
        targetPath,
        isDirectory,
        candidatePaths,
      }),
    createFile: (directory, fileName, kind) =>
      mockInvoke('create_new_file', { directory, fileName, kind }),
    createFolder: (directory, folderName) =>
      mockInvoke('create_new_folder', { directory, folderName }),
    renameFile: (oldPath, newName) =>
      mockInvoke('rename_file', { oldPath, newName }),
    renameFolder: (oldPath, newName) =>
      mockInvoke('rename_folder', { oldPath, newName }),
    deleteFile: (filePath) => mockInvoke('delete_file', { filePath }),
    deleteFolder: (folderPath) => mockInvoke('delete_folder', { folderPath }),
  },
  files: {
    read: async (filePath) => normalizeFileContent(
      await mockInvoke('read_file_with_hash', { filePath })
    ),
    save: async (request) => normalizeSaveResult(
      await mockInvoke('save_file', {
        filePath: request.filePath,
        content: request.content,
        expectedHash: request.expectedHash,
        expectedIdentity: request.expectedIdentity,
      })
    ),
    selectSavePath: (kind) => mockInvoke('select_save_file_path', { kind }),
    saveAs: async (request) => normalizeSaveResult(
      await mockInvoke('save_file_as', {
        filePath: request.filePath,
        content: request.content,
        openPaths: request.openPaths,
        sourcePath: request.sourcePath,
        isRecovery: request.isRecovery,
        forbiddenDirectory: request.forbiddenDirectory,
      })
    ),
  },
  preferences: {
    get: async () => normalizePreferences(await mockInvoke('get_preferences')),
    save: (preferences) => mockInvoke('save_preferences', { preferences }),
  },
  dialogs: {
    ask: mockAsk,
    message: mockMessage,
  },
  window: mockAppWindow,
  events: {
    onFileSystemChange: mockOnFileSystemChange,
    onCheckUnsavedBeforeClose: mockOnCheckUnsavedBeforeClose,
    onMenuCommand: mockOnMenuCommand,
  },
  app: {
    forceClose: () => mockInvoke('force_close_app'),
    cancelClose: () => mockInvoke('cancel_close_app'),
  },
}

if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'rachana', {
    configurable: true,
    value: mockNativeApi,
  })
}

// Reset mocks before each test
beforeEach(() => {
  mockInvoke.mockReset()
  mockOnFileSystemChange.mockReset()
  mockOnCheckUnsavedBeforeClose.mockReset()
  mockOnMenuCommand.mockReset()
  mockAsk.mockReset()
  mockMessage.mockReset()
  for (const method of Object.values(mockAppWindow)) {
    method.mockClear()
  }
})

// Export mocks used directly by tests.
export {
  mockAppWindow,
  mockAsk,
  mockInvoke,
  mockMessage,
  mockNativeApi,
  mockOnCheckUnsavedBeforeClose,
  mockOnFileSystemChange,
  mockOnMenuCommand,
  saveResult,
}