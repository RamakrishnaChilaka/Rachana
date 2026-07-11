import { ask } from '@tauri-apps/plugin-dialog'
import { describe, expect, it, vi } from 'vitest'
import { mockInvoke, saveResult } from '../test/setup'
import {
  DeletionFallbackValidationError,
  DeletionRecoveryError,
  useStore,
} from './useStore'
import type { OpenTab } from '../types'

let nextTestTabId = 0

function createTab(name: string, modified = false, elements: readonly any[] = []): OpenTab {
  const content = JSON.stringify({ elements, appState: {}, files: {} })
  return {
    tabId: `store-tab-${++nextTestTabId}`,
    name,
    path: `/drawings/${name}`,
    modified,
    cachedContent: content,
    contentHash: name,
    fileIdentity: `identity:${name}`,
    cachedScene: { elements, appState: {}, files: {} },
    sceneVersion: 0,
  }
}

function diskVersion(tab: OpenTab) {
  return {
    content: tab.cachedContent,
    content_hash: tab.contentHash,
    file_identity: tab.fileIdentity,
  }
}

function deletionScope(args: unknown): boolean[] {
  const {
    targetPath,
    isDirectory,
    candidatePaths,
  } = args as {
    targetPath: string
    isDirectory: boolean
    candidatePaths: string[]
  }
  const target = targetPath.replace(/\\/g, '/')
  return candidatePaths.map((path) => {
    const candidate = path.replace(/\\/g, '/')
    return isDirectory
      ? candidate === target || candidate.startsWith(`${target}/`)
      : candidate === target
  })
}

describe('tab fallback after deletion', () => {
  it('activates a remaining tab when the active file is deleted', async () => {
    const deletedTab = createTab('Deleted.excalidraw')
    const remainingTab = createTab('Remaining.excalidraw')
    mockInvoke.mockImplementation((command, args) => {
      if (command === 'get_deletion_scope_matches') {
        return Promise.resolve(deletionScope(args))
      }
      if (command === 'read_file_with_hash') {
        return Promise.resolve(diskVersion(remainingTab))
      }
      return Promise.resolve(undefined)
    })
    useStore.setState({
      currentDirectory: null,
      activeFile: deletedTab,
      fileContent: deletedTab.cachedContent,
      activeFileLoadSource: 'cache',
      isDirty: false,
      openTabs: [deletedTab, remainingTab],
    })

    await useStore.getState().deleteFile(deletedTab.path)

    const state = useStore.getState()
    expect(state.openTabs).toEqual([remainingTab])
    expect(state.activeFile?.path).toBe(remainingTab.path)
    expect(state.fileContent).toBe(remainingTab.cachedContent)
    expect(state.isDirty).toBe(false)
  })

  it('preserves the latest elements when an unsaved fallback tab becomes active', async () => {
    const deletedTab = createTab('Deleted.excalidraw')
    const latestElements = [{ id: 'latest-element', type: 'rectangle' }]
    const remainingTab = {
      ...createTab('Remaining.excalidraw', true, latestElements),
      cachedScene: {
        elements: [{ id: 'stale-element', type: 'ellipse' }],
        appState: {},
        files: {},
      },
    }
    mockInvoke.mockImplementation((command, args) => {
      if (command === 'get_deletion_scope_matches') {
        return Promise.resolve(deletionScope(args))
      }
      return Promise.resolve(undefined)
    })
    useStore.setState({
      currentDirectory: null,
      activeFile: deletedTab,
      fileContent: deletedTab.cachedContent,
      activeFileLoadSource: 'cache',
      isDirty: false,
      openTabs: [deletedTab, remainingTab],
    })
    const activePaths: Array<string | null> = []
    const unsubscribe = useStore.subscribe((state) => {
      activePaths.push(state.activeFile?.path ?? null)
    })

    try {
      await useStore.getState().deleteFile(deletedTab.path)
    } finally {
      unsubscribe()
    }

    const state = useStore.getState()
    const fallbackTab = state.openTabs[0]
    expect(activePaths).not.toContain(null)
    expect(state.activeFile?.path).toBe(remainingTab.path)
    expect(state.fileContent).toBe(remainingTab.cachedContent)
    expect(fallbackTab.cachedContent).toBe(remainingTab.cachedContent)
    expect(fallbackTab.cachedScene.elements).toEqual(latestElements)
    expect(fallbackTab.sceneVersion).toBe(remainingTab.sceneVersion)
    expect(state.isDirty).toBe(true)
  })

  it('does not overwrite newer tab state while fallback validation is pending', async () => {
    const deletedTab = createTab('Deleted.excalidraw')
    const fallbackSnapshot = createTab('Remaining.excalidraw')
    const newlyOpenedTab = createTab('Newly opened.excalidraw')
    let resolveRead!: (result: ReturnType<typeof diskVersion>) => void
    mockInvoke.mockImplementation((command, args) => {
      if (command === 'get_deletion_scope_matches') {
        return Promise.resolve(deletionScope(args))
      }
      if (command === 'read_file_with_hash') {
        return new Promise<ReturnType<typeof diskVersion>>((resolve) => {
          resolveRead = resolve
        })
      }
      return Promise.resolve(undefined)
    })
    useStore.setState({
      currentDirectory: null,
      activeFile: deletedTab,
      fileContent: deletedTab.cachedContent,
      activeFileLoadSource: 'cache',
      isDirty: false,
      openTabs: [deletedTab, fallbackSnapshot],
    })

    const deletion = useStore.getState().deleteFile(deletedTab.path)
    await vi.waitFor(() => expect(resolveRead).toBeTypeOf('function'))

    const latestElements = [{ id: 'newer-element', type: 'diamond' }]
    const newerFallback = createTab('Remaining.excalidraw', true, latestElements)
    useStore.setState({
      activeFile: newerFallback,
      fileContent: newerFallback.cachedContent,
      isDirty: true,
      openTabs: [deletedTab, newerFallback, newlyOpenedTab],
    })
    resolveRead(diskVersion(fallbackSnapshot))
    await deletion

    const state = useStore.getState()
    expect(state.activeFile?.path).toBe(newerFallback.path)
    expect(state.fileContent).toBe(newerFallback.cachedContent)
    expect(state.openTabs).toEqual([newerFallback, newlyOpenedTab])
    expect(state.isDirty).toBe(true)
  })

  it('does not activate a replacement clean fallback that was not validated', async () => {
    const deletedTab = createTab('Deleted.excalidraw')
    const validatedSnapshot = createTab('Validated.excalidraw')
    const staleReplacement = createTab('Stale.excalidraw')
    let resolveRead!: (result: ReturnType<typeof diskVersion>) => void
    mockInvoke.mockImplementation((command, args) => {
      if (command === 'get_deletion_scope_matches') {
        return Promise.resolve(deletionScope(args))
      }
      if (command === 'read_file_with_hash') {
        return new Promise<ReturnType<typeof diskVersion>>((resolve) => {
          resolveRead = resolve
        })
      }
      return Promise.resolve(undefined)
    })
    useStore.setState({
      currentDirectory: null,
      activeFile: deletedTab,
      fileContent: deletedTab.cachedContent,
      activeFileLoadSource: 'cache',
      isDirty: false,
      openTabs: [deletedTab, validatedSnapshot, staleReplacement],
    })

    const deletion = useStore.getState().deleteFile(deletedTab.path)
    await vi.waitFor(() => expect(resolveRead).toBeTypeOf('function'))
    useStore.setState({
      openTabs: [deletedTab, staleReplacement],
    })
    resolveRead(diskVersion(validatedSnapshot))

    await expect(deletion).rejects.toBeInstanceOf(DeletionFallbackValidationError)
    const state = useStore.getState()
    expect(state.openTabs).toEqual([staleReplacement])
    expect(state.activeFile).toBeNull()
    expect(state.fileContent).toBeNull()
  })

  it('aborts before disk deletion when the target changes during fallback validation', async () => {
    const deletedTab = createTab('Deleted.excalidraw')
    const remainingTab = createTab('Remaining.excalidraw')
    let resolveRead!: (result: ReturnType<typeof diskVersion>) => void
    mockInvoke.mockImplementation((command, args) => {
      if (command === 'get_deletion_scope_matches') {
        return Promise.resolve(deletionScope(args))
      }
      if (command === 'read_file_with_hash') {
        return new Promise<ReturnType<typeof diskVersion>>((resolve) => {
          resolveRead = resolve
        })
      }
      return Promise.resolve(undefined)
    })
    useStore.setState({
      currentDirectory: null,
      activeFile: deletedTab,
      fileContent: deletedTab.cachedContent,
      activeFileLoadSource: 'cache',
      isDirty: false,
      openTabs: [deletedTab, remainingTab],
    })

    const deletion = useStore.getState().deleteFile(deletedTab.path)
    await vi.waitFor(() => expect(resolveRead).toBeTypeOf('function'))

    const changedElements = [{ id: 'new-target-edit', type: 'line' }]
    const changedTarget = createTab('Deleted.excalidraw', true, changedElements)
    useStore.setState({
      activeFile: changedTarget,
      fileContent: changedTarget.cachedContent,
      isDirty: true,
      openTabs: [changedTarget, remainingTab],
    })
    resolveRead(diskVersion(remainingTab))

    await expect(deletion).rejects.toThrow('changed while deletion was pending')
    expect(mockInvoke).not.toHaveBeenCalledWith('delete_file', {
      filePath: deletedTab.path,
    })
    expect(useStore.getState().openTabs[0]).toEqual(changedTarget)
  })

  it('leaves a clean fallback inactive when disk validation fails', async () => {
    const deletedTab = createTab('Deleted.excalidraw')
    const remainingTab = createTab('Remaining.excalidraw')
    mockInvoke.mockImplementation((command, args) => {
      if (command === 'get_deletion_scope_matches') {
        return Promise.resolve(deletionScope(args))
      }
      if (command === 'read_file_with_hash') {
        return Promise.reject(new Error('hash unavailable'))
      }
      return Promise.resolve(undefined)
    })
    useStore.setState({
      currentDirectory: null,
      activeFile: deletedTab,
      fileContent: deletedTab.cachedContent,
      activeFileLoadSource: 'cache',
      isDirty: false,
      openTabs: [deletedTab, remainingTab],
    })

    await expect(useStore.getState().deleteFile(deletedTab.path)).rejects.toBeInstanceOf(
      DeletionFallbackValidationError
    )

    const state = useStore.getState()
    expect(state.openTabs).toEqual([remainingTab])
    expect(state.activeFile).toBeNull()
    expect(state.fileContent).toBeNull()
    expect(state.isDirty).toBe(false)
    expect(mockInvoke).toHaveBeenCalledWith('delete_file', {
      filePath: deletedTab.path,
    })
  })

  describe('tab instance identity', () => {
    it('keeps the shared tree entry dirty when only one duplicate is discarded', () => {
      const first = createTab('Duplicate.excalidraw', true)
      const second = {
        ...createTab('Duplicate.excalidraw', true),
        path: first.path,
      }
      useStore.setState({
        files: [{ name: first.name, path: first.path, modified: true }],
        fileTree: [{
          name: first.name,
          path: first.path,
          is_directory: false,
          modified: true,
        }],
        openTabs: [first, second],
      })

      useStore.getState().markFileAsModified(first.path, false, first.tabId)
      useStore.getState().markTreeNodeAsModified(first.path, false)

      const state = useStore.getState()
      expect(state.openTabs.find((tab) => tab.tabId === first.tabId)?.modified)
        .toBe(false)
      expect(state.openTabs.find((tab) => tab.tabId === second.tabId)?.modified)
        .toBe(true)
      expect(state.files[0].modified).toBe(true)
      expect(state.fileTree[0].modified).toBe(true)
    })

    it('preserves the active tab instance when its file is renamed', async () => {
      const tab = createTab('Before.excalidraw')
      mockInvoke.mockResolvedValueOnce('/drawings/After.excalidraw')
      useStore.setState({
        currentDirectory: null,
        activeFile: tab,
        openTabs: [tab],
      })

      await useStore.getState().renameFile(tab.path, 'After')

      const state = useStore.getState()
      expect(state.activeFile).toEqual(
        expect.objectContaining({
          tabId: tab.tabId,
          name: 'After.excalidraw',
          path: '/drawings/After.excalidraw',
        })
      )
      expect(state.openTabs[0].tabId).toBe(tab.tabId)
    })
  })

  describe('deleted-on-disk recovery tabs', () => {
    it('reports a failed save so window and tab close flows can stay open', async () => {
      const recoveryTab = {
        ...createTab('Recovery.excalidraw', true),
        recoveryState: 'deleted-on-disk' as const,
      }
      mockInvoke.mockRejectedValueOnce(new Error('path no longer exists'))
      vi.stubGlobal('alert', vi.fn())
      useStore.setState({
        activeFile: recoveryTab,
        fileContent: recoveryTab.cachedContent,
        activeFileLoadSource: 'cache',
        isDirty: true,
        openTabs: [recoveryTab],
      })

      await expect(useStore.getState().saveCurrentFile()).resolves.toBe(false)
      expect(useStore.getState().openTabs[0]).toEqual(recoveryTab)
      expect(useStore.getState().isDirty).toBe(true)
    })

    it('keeps newer edits dirty when they arrive while a save is pending', async () => {
      const recoveryTab = {
        ...createTab('Recovery.excalidraw', true),
        recoveryState: 'deleted-on-disk' as const,
      }
      let resolveSave!: (result: ReturnType<typeof saveResult>) => void
      let signalSaveStarted!: () => void
      const saveStarted = new Promise<void>((resolve) => {
        signalSaveStarted = resolve
      })
      mockInvoke.mockImplementation((command, args) => {
        if (command === 'get_deletion_scope_matches') {
          return Promise.resolve(deletionScope(args))
        }
        if (command === 'select_save_file_path') {
          return Promise.resolve('/recovered/Recovery.excalidraw')
        }
        if (command === 'save_file_as') {
          return new Promise<ReturnType<typeof saveResult>>((resolve) => {
            resolveSave = resolve
            signalSaveStarted()
          })
        }
        return Promise.resolve(undefined)
      })
      vi.stubGlobal('alert', vi.fn())
      useStore.setState({
        activeFile: recoveryTab,
        fileContent: recoveryTab.cachedContent,
        activeFileLoadSource: 'cache',
        isDirty: true,
        openTabs: [recoveryTab],
      })

      const saving = useStore.getState().saveCurrentFile()
      await saveStarted
      const latestTab = createTab(
        recoveryTab.name,
        true,
        [{ id: 'newer-than-save', type: 'ellipse' }]
      )
      useStore.setState({
        activeFile: latestTab,
        fileContent: latestTab.cachedContent,
        isDirty: true,
        openTabs: [{ ...latestTab, recoveryState: 'deleted-on-disk' }],
      })
      resolveSave(saveResult('older-snapshot-hash'))

      await expect(saving).resolves.toBe(false)
      expect(useStore.getState().openTabs[0].cachedContent).toBe(latestTab.cachedContent)
      expect(useStore.getState().openTabs[0].recoveryState).toBe('deleted-on-disk')
      expect(useStore.getState().isDirty).toBe(true)
    })

    it('keeps a recovery tab open when saving it before close fails', async () => {
      const recoveryTab = {
        ...createTab('Recovery.excalidraw', true),
        recoveryState: 'deleted-on-disk' as const,
      }
      vi.mocked(ask).mockResolvedValueOnce(true)
      mockInvoke.mockImplementation((command, args) => {
        if (command === 'get_deletion_scope_matches') {
          return Promise.resolve(deletionScope(args))
        }
        if (command === 'select_save_file_path') {
          return Promise.resolve('/recovered/Recovery.excalidraw')
        }
        if (command === 'save_file_as') {
          return Promise.reject(new Error('parent folder is missing'))
        }
        return Promise.resolve(undefined)
      })
      const alert = vi.fn()
      vi.stubGlobal('alert', alert)
      useStore.setState({
        activeFile: recoveryTab,
        fileContent: recoveryTab.cachedContent,
        activeFileLoadSource: 'cache',
        isDirty: true,
        openTabs: [recoveryTab],
      })

      await useStore.getState().closeTab(recoveryTab.path)

      expect(useStore.getState().openTabs).toEqual([recoveryTab])
      expect(useStore.getState().activeFile?.path).toBe(recoveryTab.path)
      expect(alert).toHaveBeenCalledWith(
        'Failed to save copy: Error: parent folder is missing'
      )
    })

    it('discards a recovery tab without trying to reread its deleted path', async () => {
      const recoveryTab = {
        ...createTab('Recovery.excalidraw', true),
        recoveryState: 'deleted-on-disk' as const,
      }
      vi.mocked(ask)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true)
      useStore.setState({
        activeFile: recoveryTab,
        fileContent: recoveryTab.cachedContent,
        activeFileLoadSource: 'cache',
        isDirty: true,
        openTabs: [recoveryTab],
      })

      await useStore.getState().closeTab(recoveryTab.path)

      expect(useStore.getState().openTabs).toEqual([])
      expect(useStore.getState().activeFile).toBeNull()
      expect(mockInvoke).not.toHaveBeenCalledWith('read_file_with_hash', {
        filePath: recoveryTab.path,
      })
    })

    it('does not close a recovery tab that changes while its save is pending', async () => {
      const recoveryTab = {
        ...createTab('Recovery.excalidraw', true),
        recoveryState: 'deleted-on-disk' as const,
      }
      let resolveSave!: (result: ReturnType<typeof saveResult>) => void
      let signalSaveStarted!: () => void
      const saveStarted = new Promise<void>((resolve) => {
        signalSaveStarted = resolve
      })
      vi.mocked(ask).mockResolvedValueOnce(true)
      mockInvoke.mockImplementation((command) => {
        if (command === 'select_save_file_path') {
          return Promise.resolve('/recovered/Recovery.excalidraw')
        }
        if (command === 'save_file_as') {
          return new Promise<ReturnType<typeof saveResult>>((resolve) => {
            resolveSave = resolve
            signalSaveStarted()
          })
        }
        return Promise.resolve(undefined)
      })
      const alert = vi.fn()
      vi.stubGlobal('alert', alert)
      useStore.setState({
        activeFile: recoveryTab,
        fileContent: recoveryTab.cachedContent,
        activeFileLoadSource: 'cache',
        isDirty: true,
        openTabs: [recoveryTab],
      })

      const closing = useStore.getState().closeTab(recoveryTab.path)
      await saveStarted
      const latestTab = createTab(
        'Recovery.excalidraw',
        true,
        [{ id: 'latest-recovery-edit', type: 'rectangle' }]
      )
      useStore.setState({
        activeFile: latestTab,
        fileContent: latestTab.cachedContent,
        isDirty: true,
        openTabs: [{ ...latestTab, recoveryState: 'deleted-on-disk' }],
      })
      resolveSave(saveResult('saved-older-snapshot'))
      await closing

      expect(useStore.getState().openTabs[0].cachedContent).toBe(latestTab.cachedContent)
      expect(useStore.getState().openTabs[0].recoveryState).toBe('deleted-on-disk')
      expect(alert).toHaveBeenCalledWith(
        'The drawing changed while the copy was being saved. The latest changes remain open.'
      )
    })

    it('atomically rekeys a recovery tab after Save As', () => {
      const recoveryTab = {
        ...createTab('Recovery.excalidraw', true),
        recoveryState: 'deleted-on-disk' as const,
      }
      const latestContent = JSON.stringify({
        elements: [{ id: 'saved-as', type: 'diamond' }],
        appState: {},
        files: {},
      })
      useStore.setState({
        activeFile: recoveryTab,
        fileContent: latestContent,
        activeFileLoadSource: 'cache',
        isDirty: true,
        openTabs: [{ ...recoveryTab, cachedContent: latestContent }],
      })

      useStore.getState().applySaveAsResult(
        recoveryTab.path,
        String.raw`C:\Drawings\Recovered.excalidraw`,
        latestContent,
        'saved-as-hash',
        'saved-as-identity'
      )

      const state = useStore.getState()
      expect(state.openTabs).toHaveLength(1)
      expect(state.openTabs[0]).toMatchObject({
        name: 'Recovered.excalidraw',
        path: String.raw`C:\Drawings\Recovered.excalidraw`,
        modified: false,
        contentHash: 'saved-as-hash',
        fileIdentity: 'saved-as-identity',
        recoveryState: undefined,
      })
      expect(state.openTabs[0].cachedScene.elements).toEqual([
        { id: 'saved-as', type: 'diamond' },
      ])
      expect(state.activeFile).toEqual({
        tabId: recoveryTab.tabId,
        name: 'Recovered.excalidraw',
        path: String.raw`C:\Drawings\Recovered.excalidraw`,
        modified: false,
      })
      expect(state.isDirty).toBe(false)
    })
  })

  it('preserves edits made while native file deletion is pending as a recovery tab', async () => {
    const deletedTab = createTab('Deleted.excalidraw')
    const fallbackTab = createTab('Fallback.excalidraw')
    let resolveDelete!: () => void
    let signalDeleteStarted!: () => void
    const deleteStarted = new Promise<void>((resolve) => {
      signalDeleteStarted = resolve
    })
    mockInvoke.mockImplementation((command, args) => {
      if (command === 'get_deletion_scope_matches') {
        return Promise.resolve(deletionScope(args))
      }
      if (command === 'read_file_with_hash') {
        return Promise.resolve(diskVersion(fallbackTab))
      }
      if (command === 'delete_file') {
        signalDeleteStarted()
        return new Promise<void>((resolve) => {
          resolveDelete = resolve
        })
      }
      return Promise.resolve(undefined)
    })
    useStore.setState({
      currentDirectory: null,
      activeFile: deletedTab,
      fileContent: deletedTab.cachedContent,
      activeFileLoadSource: 'cache',
      isDirty: false,
      openTabs: [deletedTab, fallbackTab],
    })

    const deletion = useStore.getState().deleteFile(deletedTab.path)
    await deleteStarted
    const latestElements = [{ id: 'during-delete', type: 'arrow' }]
    const changedTarget = {
      ...createTab('Deleted.excalidraw', true, latestElements),
      tabId: deletedTab.tabId,
    }
    useStore.setState({
      activeFile: changedTarget,
      fileContent: changedTarget.cachedContent,
      isDirty: true,
      openTabs: [changedTarget, fallbackTab],
    })
    resolveDelete()

    await expect(deletion).rejects.toBeInstanceOf(DeletionRecoveryError)
    const state = useStore.getState()
    const recoveryTab = state.openTabs.find((tab) => tab.path === changedTarget.path)
    expect(recoveryTab?.recoveryState).toBe('deleted-on-disk')
    expect(recoveryTab?.cachedScene.elements).toEqual(latestElements)
    expect(recoveryTab?.modified).toBe(true)
    expect(state.activeFile?.path).toBe(changedTarget.path)
    expect(state.fileContent).toBe(changedTarget.cachedContent)
    expect(state.isDirty).toBe(true)
  })

  it('preserves changed folder tabs and removes unchanged tabs after native deletion', async () => {
    const folderPath = '/drawings/Folder'
    const activeTab = {
      ...createTab('Active.excalidraw'),
      path: `${folderPath}/Active.excalidraw`,
    }
    const unchangedTab = {
      ...createTab('Unchanged.excalidraw'),
      path: `${folderPath}/Unchanged.excalidraw`,
    }
    const fallbackTab = createTab('Fallback.excalidraw')
    let resolveDelete!: () => void
    let signalDeleteStarted!: () => void
    const deleteStarted = new Promise<void>((resolve) => {
      signalDeleteStarted = resolve
    })
    mockInvoke.mockImplementation((command, args) => {
      if (command === 'get_deletion_scope_matches') {
        return Promise.resolve(deletionScope(args))
      }
      if (command === 'read_file_with_hash') {
        return Promise.resolve(diskVersion(fallbackTab))
      }
      if (command === 'delete_folder') {
        signalDeleteStarted()
        return new Promise<void>((resolve) => {
          resolveDelete = resolve
        })
      }
      return Promise.resolve(undefined)
    })
    useStore.setState({
      currentDirectory: null,
      activeFile: activeTab,
      fileContent: activeTab.cachedContent,
      activeFileLoadSource: 'cache',
      isDirty: false,
      openTabs: [activeTab, unchangedTab, fallbackTab],
    })

    const deletion = useStore.getState().deleteFolder(folderPath)
    await deleteStarted
    const latestElements = [{ id: 'folder-recovery', type: 'text' }]
    const changedActiveTab = {
      ...createTab('Active.excalidraw', true, latestElements),
      tabId: activeTab.tabId,
      path: activeTab.path,
    }
    useStore.setState({
      activeFile: changedActiveTab,
      fileContent: changedActiveTab.cachedContent,
      isDirty: true,
      openTabs: [changedActiveTab, unchangedTab, fallbackTab],
    })
    resolveDelete()

    await expect(deletion).rejects.toBeInstanceOf(DeletionRecoveryError)
    const state = useStore.getState()
    expect(state.openTabs.map((tab) => tab.path)).toEqual([
      changedActiveTab.path,
      fallbackTab.path,
    ])
    expect(state.openTabs[0].recoveryState).toBe('deleted-on-disk')
    expect(state.openTabs[0].cachedScene.elements).toEqual(latestElements)
    expect(state.activeFile?.path).toBe(changedActiveTab.path)
    expect(state.fileContent).toBe(changedActiveTab.cachedContent)
    expect(state.isDirty).toBe(true)
  })
})
