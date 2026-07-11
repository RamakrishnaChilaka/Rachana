import { ask } from '@tauri-apps/plugin-dialog'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenTab } from '../types'
import { mockInvoke, saveResult } from '../test/setup'
import { useStore } from './useStore'

let nextTestTabId = 0

function createTab(
  name: string,
  modified = false,
  elements: readonly any[] = [],
  path = `/drawings/${name}`
): OpenTab {
  const content = JSON.stringify({ elements, appState: {}, files: {} })
  return {
    tabId: `lifecycle-tab-${++nextTestTabId}`,
    name,
    path,
    modified,
    cachedContent: content,
    contentHash: `${name}-hash`,
    fileIdentity: `identity:${path}`,
    cachedScene: { elements, appState: {}, files: {} },
    sceneVersion: 0,
  }
}

function diskVersion(
  tab: OpenTab,
  overrides: Partial<{
    content: string
    content_hash: string
    file_identity: string
  }> = {}
) {
  return {
    content: tab.cachedContent,
    content_hash: tab.contentHash,
    file_identity: tab.fileIdentity,
    ...overrides,
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

function setTabs(activeTab: OpenTab, openTabs: OpenTab[] = [activeTab]) {
  useStore.setState({
    currentDirectory: '/drawings',
    files: [],
    fileTree: [],
    activeFile: activeTab,
    fileContent: activeTab.cachedContent,
    activeFileLoadSource: 'cache',
    isDirty: activeTab.modified,
    openTabs,
  })
}

beforeEach(() => {
  vi.mocked(ask).mockReset()
  vi.stubGlobal('alert', vi.fn())
})

describe('external file reconciliation', () => {
  it('retains a dirty active tab as recovery after external deletion', async () => {
    const dirtyTab = createTab(
      'Dirty.excalidraw',
      true,
      [{ id: 'latest-external-edit', type: 'rectangle' }]
    )
    mockInvoke.mockRejectedValueOnce(new Error('no such file'))
    setTabs(dirtyTab)

    await useStore.getState().reconcileActiveFileAfterExternalChange()

    const state = useStore.getState()
    expect(mockInvoke).toHaveBeenCalledWith('read_file_with_hash', {
      filePath: dirtyTab.path,
    })
    expect(state.openTabs[0].recoveryState).toBe('deleted-on-disk')
    expect(state.openTabs[0].cachedScene.elements).toEqual(
      JSON.parse(dirtyTab.cachedContent).elements
    )
    expect(state.activeFile?.path).toBe(dirtyTab.path)
    expect(state.fileContent).toBe(dirtyTab.cachedContent)
    expect(state.isDirty).toBe(true)
  })

  it('removes a clean active tab after confirmed external deletion', async () => {
    const cleanTab = createTab('Clean.excalidraw')
    mockInvoke.mockRejectedValueOnce(new Error('no such file'))
    setTabs(cleanTab)

    await useStore.getState().reconcileActiveFileAfterExternalChange()

    const state = useStore.getState()
    expect(state.openTabs).toEqual([])
    expect(state.activeFile).toBeNull()
    expect(state.fileContent).toBeNull()
    expect(state.isDirty).toBe(false)
  })

  it('keeps a valid open tab outside the workspace tree', async () => {
    const outsideTab = createTab(
      'Outside.excalidraw',
      false,
      [],
      '/other-workspace/Outside.excalidraw'
    )
    mockInvoke.mockResolvedValueOnce(diskVersion(outsideTab))
    setTabs(outsideTab)

    await useStore.getState().reconcileActiveFileAfterExternalChange()

    expect(useStore.getState().openTabs).toEqual([outsideTab])
    expect(useStore.getState().activeFile?.path).toBe(outsideTab.path)
  })

  it('reloads clean active and inactive tabs changed on disk', async () => {
    const activeTab = createTab('Active.excalidraw')
    const inactiveTab = createTab('Inactive.excalidraw')
    const activeContent = JSON.stringify({
      elements: [{ id: 'active-disk', type: 'rectangle' }],
      appState: {},
      files: {},
    })
    const inactiveContent = JSON.stringify({
      elements: [{ id: 'inactive-disk', type: 'ellipse' }],
      appState: {},
      files: {},
    })
    mockInvoke.mockImplementation((_command, args) => {
      const filePath = (args as { filePath: string }).filePath
      return Promise.resolve(
        filePath === activeTab.path
          ? diskVersion(activeTab, {
              content: activeContent,
              content_hash: 'active-disk-hash',
            })
          : diskVersion(inactiveTab, {
              content: inactiveContent,
              content_hash: 'inactive-disk-hash',
            })
      )
    })
    setTabs(activeTab, [activeTab, inactiveTab])

    await useStore.getState().reconcileActiveFileAfterExternalChange()

    const state = useStore.getState()
    expect(state.fileContent).toBe(activeContent)
    expect(state.isDirty).toBe(false)
    expect(state.openTabs).toEqual([
      expect.objectContaining({
        path: activeTab.path,
        cachedContent: activeContent,
        contentHash: 'active-disk-hash',
        modified: false,
      }),
      expect.objectContaining({
        path: inactiveTab.path,
        cachedContent: inactiveContent,
        contentHash: 'inactive-disk-hash',
        modified: false,
      }),
    ])
  })

  it('retains dirty active and inactive content as explicit disk conflicts', async () => {
    const activeTab = createTab(
      'Active.excalidraw',
      true,
      [{ id: 'active-local', type: 'diamond' }]
    )
    const inactiveTab = createTab(
      'Inactive.excalidraw',
      true,
      [{ id: 'inactive-local', type: 'arrow' }]
    )
    mockInvoke.mockImplementation((_command, args) => {
      const filePath = (args as { filePath: string }).filePath
      const tab = filePath === activeTab.path ? activeTab : inactiveTab
      return Promise.resolve(
        diskVersion(tab, {
          content: JSON.stringify({ elements: [], appState: {}, files: {} }),
          content_hash: `changed:${tab.name}`,
          file_identity: `replacement:${tab.name}`,
        })
      )
    })
    setTabs(activeTab, [activeTab, inactiveTab])

    await useStore.getState().reconcileActiveFileAfterExternalChange()

    const state = useStore.getState()
    expect(state.fileContent).toBe(activeTab.cachedContent)
    expect(state.isDirty).toBe(true)
    expect(state.openTabs).toEqual([
      expect.objectContaining({
        path: activeTab.path,
        cachedContent: activeTab.cachedContent,
        externalConflict: 'modified-on-disk',
      }),
      expect.objectContaining({
        path: inactiveTab.path,
        cachedContent: inactiveTab.cachedContent,
        externalConflict: 'modified-on-disk',
      }),
    ])
  })

  it('refreshes filesystem identity after a same-content clean replacement', async () => {
    const cleanTab = createTab('Replaced.excalidraw')
    mockInvoke.mockResolvedValueOnce(
      diskVersion(cleanTab, { file_identity: 'replacement-identity' })
    )
    setTabs(cleanTab)

    await useStore.getState().reconcileActiveFileAfterExternalChange()

    expect(useStore.getState().openTabs[0]).toEqual(
      expect.objectContaining({
        cachedContent: cleanTab.cachedContent,
        contentHash: cleanTab.contentHash,
        fileIdentity: 'replacement-identity',
        modified: false,
      })
    )
  })

  it('preserves an edit made during inspection and marks the tab conflicted', async () => {
    const cleanTab = createTab('Racing.excalidraw')
    let resolveRead!: (result: ReturnType<typeof diskVersion>) => void
    mockInvoke.mockImplementation(
      () => new Promise<ReturnType<typeof diskVersion>>((resolve) => {
        resolveRead = resolve
      })
    )
    setTabs(cleanTab)

    const reconciliation = useStore.getState().reconcileActiveFileAfterExternalChange()
    await vi.waitFor(() => expect(resolveRead).toBeTypeOf('function'))
    const editedTab = {
      ...cleanTab,
      modified: true,
      cachedContent: JSON.stringify({
        elements: [{ id: 'local-race', type: 'line' }],
        appState: {},
        files: {},
      }),
    }
    useStore.setState({
      activeFile: editedTab,
      fileContent: editedTab.cachedContent,
      isDirty: true,
      openTabs: [editedTab],
    })
    resolveRead(
      diskVersion(cleanTab, {
        content: JSON.stringify({
          elements: [{ id: 'disk-race', type: 'frame' }],
          appState: {},
          files: {},
        }),
        content_hash: 'disk-race-hash',
      })
    )
    await reconciliation

    const state = useStore.getState()
    expect(state.fileContent).toBe(editedTab.cachedContent)
    expect(state.openTabs[0]).toEqual(
      expect.objectContaining({
        cachedContent: editedTab.cachedContent,
        externalConflict: 'modified-on-disk',
        modified: true,
      })
    )
  })

  it('does not report a clean tab as saved when disk inspection fails', async () => {
    const cleanTab = createTab('Unreadable.excalidraw')
    mockInvoke.mockRejectedValueOnce(new Error('permission denied'))
    setTabs(cleanTab)

    await useStore.getState().reconcileActiveFileAfterExternalChange()

    expect(useStore.getState().openTabs[0]).toEqual(
      expect.objectContaining({
        path: cleanTab.path,
        cachedContent: cleanTab.cachedContent,
        externalConflict: 'modified-on-disk',
        modified: true,
      })
    )
    expect(useStore.getState().isDirty).toBe(true)
  })

  it('serializes overlapping watcher reads so the newest disk version wins', async () => {
    const cleanTab = createTab('Ordered.excalidraw')
    const firstContent = JSON.stringify({
      elements: [{ id: 'first-event', type: 'rectangle' }],
      appState: {},
      files: {},
    })
    const secondContent = JSON.stringify({
      elements: [{ id: 'second-event', type: 'ellipse' }],
      appState: {},
      files: {},
    })
    let resolveFirstRead!: (result: ReturnType<typeof diskVersion>) => void
    mockInvoke
      .mockImplementationOnce(
        () => new Promise<ReturnType<typeof diskVersion>>((resolve) => {
          resolveFirstRead = resolve
        })
      )
      .mockResolvedValueOnce(
        diskVersion(cleanTab, {
          content: secondContent,
          content_hash: 'second-event-hash',
        })
      )
    setTabs(cleanTab)

    const firstReconciliation =
      useStore.getState().reconcileActiveFileAfterExternalChange()
    const secondReconciliation =
      useStore.getState().reconcileActiveFileAfterExternalChange()
    await vi.waitFor(() => expect(resolveFirstRead).toBeTypeOf('function'))
    resolveFirstRead(
      diskVersion(cleanTab, {
        content: firstContent,
        content_hash: 'first-event-hash',
      })
    )
    await Promise.all([firstReconciliation, secondReconciliation])

    expect(useStore.getState().openTabs[0]).toEqual(
      expect.objectContaining({
        cachedContent: secondContent,
        contentHash: 'second-event-hash',
        modified: false,
      })
    )
  })

  it('reconciles duplicate and normalized-alias tabs without deadlocking the FIFO', async () => {
    const original = createTab(
      'Original.excalidraw',
      false,
      [],
      String.raw`C:\Drawings\Shared.excalidraw`
    )
    const duplicate = { ...original }
    const alias = createTab(
      'Alias.excalidraw',
      false,
      [],
      'c:/drawings/SHARED.excalidraw'
    )
    mockInvoke.mockImplementation((_command, args) => {
      const filePath = (args as { filePath: string }).filePath
      return Promise.resolve(diskVersion(
        filePath === original.path ? original : alias
      ))
    })
    setTabs(original, [original, duplicate, alias])

    await useStore.getState().reconcileActiveFileAfterExternalChange()

    expect(
      mockInvoke.mock.calls
        .filter(([command]) => command === 'read_file_with_hash')
        .map(([, args]) => (args as { filePath: string }).filePath)
    ).toEqual([original.path, alias.path])
    expect(useStore.getState().openTabs).toHaveLength(3)
  })

  it('preserves divergent exact-path duplicate content as an explicit conflict', async () => {
    const first = createTab('Duplicate.excalidraw')
    const second = createTab(
      first.name,
      true,
      [{ id: 'divergent-local-edit', type: 'rectangle' }],
      first.path
    )
    setTabs(first, [first, second])

    await useStore.getState().reconcileActiveFileAfterExternalChange()

    expect(mockInvoke).not.toHaveBeenCalledWith(
      'read_file_with_hash',
      expect.anything()
    )
    expect(useStore.getState().openTabs).toEqual([
      expect.objectContaining({
        cachedContent: first.cachedContent,
        modified: true,
        externalConflict: 'modified-on-disk',
      }),
      expect.objectContaining({
        cachedContent: second.cachedContent,
        modified: true,
        externalConflict: 'modified-on-disk',
      }),
    ])
    expect(useStore.getState().fileContent).toBe(first.cachedContent)
    expect(useStore.getState().isDirty).toBe(true)
  })

  it('deduplicates concurrent loads of the same normalized path', async () => {
    const file = createTab(
      'Concurrent.excalidraw',
      false,
      [],
      String.raw`C:\Drawings\Concurrent.excalidraw`
    )
    const alias = {
      ...file,
      path: 'c:/drawings/CONCURRENT.excalidraw',
    }
    mockInvoke.mockResolvedValue(diskVersion(file))
    useStore.setState({
      currentDirectory: '/drawings',
      files: [],
      fileTree: [],
      activeFile: null,
      fileContent: null,
      activeFileLoadSource: null,
      isDirty: false,
      openTabs: [],
    })

    await Promise.all([
      useStore.getState().loadFile(file),
      useStore.getState().loadFile(alias),
    ])

    expect(
      mockInvoke.mock.calls.filter(([command]) => command === 'read_file_with_hash')
    ).toHaveLength(2)
    expect(useStore.getState().openTabs).toHaveLength(1)
    expect(useStore.getState().activeFile?.path).toBe(file.path)
  })
})

describe('save completion lifecycle guards', () => {
  it('waits for an app save before reconciling its watcher event', async () => {
    const tab = createTab('Own-save.excalidraw', true)
    const saved = saveResult('own-save-hash', 'own-save-identity')
    let resolveSave!: (result: ReturnType<typeof saveResult>) => void
    mockInvoke.mockImplementation((command) => {
      if (command === 'save_file') {
        return new Promise<ReturnType<typeof saveResult>>((resolve) => {
          resolveSave = resolve
        })
      }
      if (command === 'read_file_with_hash') {
        return Promise.resolve({
          content: tab.cachedContent,
          ...saved,
        })
      }
      return Promise.resolve(undefined)
    })
    setTabs(tab)

    const saving = useStore.getState().saveCurrentFile()
    await vi.waitFor(() => expect(resolveSave).toBeTypeOf('function'))
    const reconciliation =
      useStore.getState().reconcileActiveFileAfterExternalChange()
    expect(mockInvoke).not.toHaveBeenCalledWith(
      'read_file_with_hash',
      expect.anything()
    )
    resolveSave(saved)

    await expect(saving).resolves.toBe(true)
    await reconciliation
    expect(useStore.getState().openTabs[0]).toEqual(
      expect.objectContaining({
        contentHash: saved.content_hash,
        fileIdentity: saved.file_identity,
        externalConflict: undefined,
        modified: false,
      })
    )
  })

  it('queues watcher inspection between an active save and a later save', async () => {
    const tab = createTab('Save-inspect-save.excalidraw', true)
    const operationOrder: string[] = []
    let saveCount = 0
    let resolveFirstSave!: (result: ReturnType<typeof saveResult>) => void
    let resolveInspection!: (result: ReturnType<typeof diskVersion>) => void
    mockInvoke.mockImplementation((command) => {
      if (command === 'save_file') {
        saveCount += 1
        operationOrder.push(`save-${saveCount}`)
        if (saveCount === 1) {
          return new Promise<ReturnType<typeof saveResult>>((resolve) => {
            resolveFirstSave = resolve
          })
        }
        return Promise.resolve(saveResult('second-save-hash', 'second-save-identity'))
      }
      if (command === 'read_file_with_hash') {
        operationOrder.push('inspection')
        return new Promise<ReturnType<typeof diskVersion>>((resolve) => {
          resolveInspection = resolve
        })
      }
      return Promise.resolve(undefined)
    })
    setTabs(tab)

    const firstSave = useStore.getState().saveCurrentFile()
    await vi.waitFor(() => expect(resolveFirstSave).toBeTypeOf('function'))
    const inspection = useStore.getState().reconcileActiveFileAfterExternalChange()
    const secondSave = useStore.getState().saveCurrentFile()

    expect(operationOrder).toEqual(['save-1'])
    resolveFirstSave(saveResult('first-save-hash', 'first-save-identity'))
    await vi.waitFor(() => expect(resolveInspection).toBeTypeOf('function'))
    expect(operationOrder).toEqual(['save-1', 'inspection'])

    resolveInspection(
      diskVersion(tab, {
        content_hash: 'first-save-hash',
        file_identity: 'first-save-identity',
      })
    )
    await inspection
    await vi.waitFor(() => expect(operationOrder).toEqual([
      'save-1',
      'inspection',
      'save-2',
    ]))

    await expect(firstSave).resolves.toBe(true)
    await expect(secondSave).resolves.toBe(true)
    expect(useStore.getState().openTabs[0]).toEqual(
      expect.objectContaining({
        contentHash: 'second-save-hash',
        fileIdentity: 'second-save-identity',
        modified: false,
      })
    )
  })

  it('releases the inspection queue after an inspection failure', async () => {
    const tab = createTab('Failed-inspection-queue.excalidraw', true)
    let saveCount = 0
    let resolveFirstSave!: (result: ReturnType<typeof saveResult>) => void
    mockInvoke.mockImplementation((command) => {
      if (command === 'save_file') {
        saveCount += 1
        if (saveCount === 1) {
          return new Promise<ReturnType<typeof saveResult>>((resolve) => {
            resolveFirstSave = resolve
          })
        }
        return Promise.resolve(saveResult('unexpected-second-save'))
      }
      if (command === 'read_file_with_hash') {
        return Promise.reject(new Error('transient read lock failure'))
      }
      return Promise.resolve(undefined)
    })
    setTabs(tab)

    const firstSave = useStore.getState().saveCurrentFile()
    await vi.waitFor(() => expect(resolveFirstSave).toBeTypeOf('function'))
    const inspection = useStore.getState().reconcileActiveFileAfterExternalChange()
    const laterSave = useStore.getState().saveCurrentFile()
    resolveFirstSave(saveResult('first-save-hash', 'first-save-identity'))

    await expect(firstSave).resolves.toBe(true)
    await inspection
    await expect(laterSave).resolves.toBe(false)
    expect(saveCount).toBe(1)
    expect(useStore.getState().openTabs[0]).toEqual(
      expect.objectContaining({
        externalConflict: 'modified-on-disk',
        modified: true,
      })
    )
  })

  it('retains content when a dirty file disappears during an app save', async () => {
    const tab = createTab('Deleted-during-save.excalidraw', true)
    let resolveSave!: (result: ReturnType<typeof saveResult>) => void
    mockInvoke.mockImplementation((command) => {
      if (command === 'save_file') {
        return new Promise<ReturnType<typeof saveResult>>((resolve) => {
          resolveSave = resolve
        })
      }
      if (command === 'read_file_with_hash') {
        return Promise.reject(new Error('no such file'))
      }
      return Promise.resolve(undefined)
    })
    setTabs(tab)

    const saving = useStore.getState().saveCurrentFile()
    await vi.waitFor(() => expect(resolveSave).toBeTypeOf('function'))
    const reconciliation =
      useStore.getState().reconcileActiveFileAfterExternalChange()
    resolveSave(saveResult('deleted-save-hash', 'deleted-save-identity'))

    await expect(saving).resolves.toBe(true)
    await reconciliation
    expect(useStore.getState().openTabs[0]).toEqual(
      expect.objectContaining({
        path: tab.path,
        cachedContent: tab.cachedContent,
        recoveryState: 'deleted-on-disk',
        modified: true,
      })
    )
    expect(useStore.getState().isDirty).toBe(true)
  })

  it('keeps an active file recovery tab after a deferred save succeeds', async () => {
    const tab = createTab('Active-deleted.excalidraw', true)
    let resolveSave!: (result: ReturnType<typeof saveResult>) => void
    mockInvoke.mockImplementation((command) => {
      if (command === 'save_file') {
        return new Promise<ReturnType<typeof saveResult>>((resolve) => {
          resolveSave = resolve
        })
      }
      return Promise.resolve(undefined)
    })
    setTabs(tab)

    const saving = useStore.getState().saveCurrentFile()
    await vi.waitFor(() => expect(resolveSave).toBeTypeOf('function'))
    useStore.setState({
      activeFile: { ...tab, modified: true },
      fileContent: tab.cachedContent,
      isDirty: true,
      openTabs: [{
        ...tab,
        recoveryState: 'deleted-on-disk',
        lifecycleVersion: 1,
      }],
    })
    resolveSave(saveResult('completed-before-delete-observed'))

    await expect(saving).resolves.toBe(false)
    const state = useStore.getState()
    expect(state.openTabs[0]).toEqual(
      expect.objectContaining({
        path: tab.path,
        recoveryState: 'deleted-on-disk',
        modified: true,
      })
    )
    expect(state.activeFile?.path).toBe(tab.path)
    expect(state.isDirty).toBe(true)
  })

  it('keeps an inactive folder recovery tab after a deferred save fails', async () => {
    const activeTab = createTab('Active.excalidraw')
    const folderTab = createTab(
      'Inside.excalidraw',
      true,
      [{ id: 'folder-local', type: 'rectangle' }],
      '/drawings/Deleted-folder/Inside.excalidraw'
    )
    let rejectSave!: (error: Error) => void
    mockInvoke.mockImplementation((command) => {
      if (command === 'save_file') {
        return new Promise<ReturnType<typeof saveResult>>((_resolve, reject) => {
          rejectSave = reject
        })
      }
      return Promise.resolve(undefined)
    })
    setTabs(activeTab, [activeTab, folderTab])

    const saving = useStore.getState().saveTabForWorkspaceResolution(folderTab.path)
    await vi.waitFor(() => expect(rejectSave).toBeTypeOf('function'))
    useStore.setState({
      openTabs: [
        activeTab,
        {
          ...folderTab,
          recoveryState: 'deleted-on-disk',
          lifecycleVersion: 1,
        },
      ],
    })
    rejectSave(new Error('save completed after folder deletion'))

    await expect(saving).resolves.toBe(false)
    const state = useStore.getState()
    expect(state.activeFile?.path).toBe(activeTab.path)
    expect(state.isDirty).toBe(false)
    expect(state.openTabs).toEqual([
      activeTab,
      expect.objectContaining({
        path: folderTab.path,
        cachedContent: folderTab.cachedContent,
        recoveryState: 'deleted-on-disk',
        modified: true,
      }),
    ])
  })

  it('ignores a stale regular-save result after the tab is rekeyed by Save As', async () => {
    const tab = createTab('Rekey-during-save.excalidraw', true)
    let resolveSave!: (result: ReturnType<typeof saveResult>) => void
    mockInvoke.mockImplementation((command) => {
      if (command === 'save_file') {
        return new Promise<ReturnType<typeof saveResult>>((resolve) => {
          resolveSave = resolve
        })
      }
      return Promise.resolve(undefined)
    })
    setTabs(tab)

    const saving = useStore.getState().saveCurrentFile()
    await vi.waitFor(() => expect(resolveSave).toBeTypeOf('function'))
    const rekeyedTab = {
      ...tab,
      name: 'Rekeyed.excalidraw',
      path: '/copies/Rekeyed.excalidraw',
      modified: false,
      contentHash: 'rekeyed-hash',
      fileIdentity: 'rekeyed-identity',
      lifecycleVersion: 1,
    }
    useStore.setState({
      activeFile: {
        tabId: rekeyedTab.tabId,
        name: rekeyedTab.name,
        path: rekeyedTab.path,
        modified: false,
      },
      fileContent: rekeyedTab.cachedContent,
      isDirty: false,
      openTabs: [rekeyedTab],
    })
    resolveSave(saveResult('stale-source-hash', 'stale-source-identity'))

    await expect(saving).resolves.toBe(false)
    expect(useStore.getState().openTabs).toEqual([rekeyedTab])
    expect(useStore.getState().activeFile).toEqual(
      expect.objectContaining({
        tabId: rekeyedTab.tabId,
        path: rekeyedTab.path,
        modified: false,
      })
    )
  })
})

describe('safe switching and recovery persistence', () => {
  it('preserves an inactive modified tab when disk changed before activation', async () => {
    const activeTab = createTab('Active.excalidraw')
    const modifiedTab = createTab(
      'Modified.excalidraw',
      true,
      [{ id: 'inactive-local', type: 'rectangle' }]
    )
    mockInvoke.mockResolvedValueOnce(
      diskVersion(modifiedTab, {
        content: JSON.stringify({
          elements: [{ id: 'inactive-disk', type: 'ellipse' }],
          appState: {},
          files: {},
        }),
        content_hash: 'inactive-disk-hash',
      })
    )
    setTabs(activeTab, [activeTab, modifiedTab])

    await useStore.getState().loadFile(modifiedTab)

    const state = useStore.getState()
    expect(state.activeFile?.path).toBe(modifiedTab.path)
    expect(state.fileContent).toBe(modifiedTab.cachedContent)
    expect(state.isDirty).toBe(true)
    expect(state.openTabs[1]).toEqual(
      expect.objectContaining({
        cachedContent: modifiedTab.cachedContent,
        externalConflict: 'modified-on-disk',
        modified: true,
      })
    )
  })

  it('refreshes identity for a same-content replacement before activation', async () => {
    const activeTab = createTab('Active.excalidraw')
    const cleanTab = createTab('Clean.excalidraw')
    mockInvoke.mockResolvedValueOnce(
      diskVersion(cleanTab, { file_identity: 'replacement-identity' })
    )
    setTabs(activeTab, [activeTab, cleanTab])

    await useStore.getState().loadFile(cleanTab)

    expect(useStore.getState().openTabs[1]).toEqual(
      expect.objectContaining({
        path: cleanTab.path,
        contentHash: cleanTab.contentHash,
        fileIdentity: 'replacement-identity',
        sceneVersion: cleanTab.sceneVersion + 1,
        modified: false,
      })
    )
  })

  it('does not overwrite newer inactive edits when activation validation resolves', async () => {
    const activeTab = createTab('Active.excalidraw')
    const targetTab = createTab('Target.excalidraw', true)
    let resolveRead!: (result: ReturnType<typeof diskVersion>) => void
    mockInvoke.mockImplementationOnce(
      () => new Promise<ReturnType<typeof diskVersion>>((resolve) => {
        resolveRead = resolve
      })
    )
    setTabs(activeTab, [activeTab, targetTab])

    const activation = useStore.getState().loadFile(targetTab)
    await vi.waitFor(() => expect(resolveRead).toBeTypeOf('function'))
    const latestContent = JSON.stringify({
      elements: [{ id: 'newer-inactive-edit', type: 'diamond' }],
      appState: {},
      files: {},
    })
    const latestTarget = {
      ...targetTab,
      cachedContent: latestContent,
      modified: true,
    }
    useStore.setState({
      openTabs: [activeTab, latestTarget],
    })
    resolveRead(diskVersion(targetTab))
    await activation

    const state = useStore.getState()
    expect(state.activeFile?.path).toBe(targetTab.path)
    expect(state.fileContent).toBe(latestContent)
    expect(state.openTabs[1]).toEqual(latestTarget)
    expect(state.isDirty).toBe(true)
  })

  it('blocks tab switching when saving the active tab fails', async () => {
    const dirtyTab = createTab('Dirty.excalidraw', true)
    const targetTab = createTab('Target.excalidraw')
    vi.mocked(ask).mockResolvedValueOnce(true)
    mockInvoke.mockRejectedValueOnce(new Error('disk unavailable'))
    setTabs(dirtyTab, [dirtyTab, targetTab])

    await useStore.getState().loadFile(targetTab)

    const state = useStore.getState()
    expect(state.activeFile?.path).toBe(dirtyTab.path)
    expect(state.openTabs[0].modified).toBe(true)
    expect(state.isDirty).toBe(true)
  })

  it('routes manual recovery Save through Save As without writing the stale path', async () => {
    const recoveryTab = {
      ...createTab('Recovery.excalidraw', true),
      recoveryState: 'deleted-on-disk' as const,
    }
    const destination = '/recovered/Recovery.excalidraw'
    mockInvoke.mockImplementation((command) => {
      if (command === 'select_save_file_path') {
        return Promise.resolve(destination)
      }
      if (command === 'save_file_as') {
        return Promise.resolve(saveResult('recovered-hash'))
      }
      return Promise.resolve(undefined)
    })
    setTabs(recoveryTab)

    await expect(useStore.getState().saveCurrentFile()).resolves.toBe(true)

    expect(mockInvoke).toHaveBeenCalledWith('select_save_file_path')
    expect(mockInvoke).toHaveBeenCalledWith('save_file_as', {
      filePath: destination,
      content: recoveryTab.cachedContent,
      openPaths: [recoveryTab.path],
      sourcePath: recoveryTab.path,
      isRecovery: true,
    })
    expect(mockInvoke).not.toHaveBeenCalledWith('save_file', expect.anything())
    expect(useStore.getState().activeFile?.path).toBe(destination)
    expect(useStore.getState().openTabs[0].recoveryState).toBeUndefined()
  })

  it('routes a disk conflict through Save As instead of overwriting the changed file', async () => {
    const conflictTab = {
      ...createTab('Conflict.excalidraw', true),
      externalConflict: 'modified-on-disk' as const,
    }
    const destination = '/copies/Conflict copy.excalidraw'
    mockInvoke.mockImplementation((command) => {
      if (command === 'select_save_file_path') {
        return Promise.resolve(destination)
      }
      if (command === 'save_file_as') {
        return Promise.resolve(saveResult('conflict-copy-hash', 'conflict-copy-identity'))
      }
      return Promise.resolve(undefined)
    })
    setTabs(conflictTab)

    await expect(useStore.getState().saveCurrentFile()).resolves.toBe(true)

    expect(mockInvoke).not.toHaveBeenCalledWith('save_file', expect.anything())
    expect(mockInvoke).toHaveBeenCalledWith(
      'save_file_as',
      expect.objectContaining({
        sourcePath: conflictTab.path,
        filePath: destination,
        content: conflictTab.cachedContent,
      })
    )
    expect(useStore.getState().openTabs[0]).toEqual(
      expect.objectContaining({
        path: destination,
        contentHash: 'conflict-copy-hash',
        fileIdentity: 'conflict-copy-identity',
        externalConflict: undefined,
        modified: false,
      })
    )
  })

  it('requires Save As before closing an inactive disk conflict', async () => {
    const activeTab = createTab('Active.excalidraw')
    const conflictTab = {
      ...createTab('Conflict.excalidraw', true),
      externalConflict: 'modified-on-disk' as const,
    }
    const destination = '/copies/Conflict copy.excalidraw'
    vi.mocked(ask).mockResolvedValueOnce(true)
    mockInvoke.mockImplementation((command) => {
      if (command === 'select_save_file_path') {
        return Promise.resolve(destination)
      }
      if (command === 'save_file_as') {
        return Promise.resolve(saveResult('closed-copy-hash', 'closed-copy-identity'))
      }
      return Promise.resolve(undefined)
    })
    setTabs(activeTab, [activeTab, conflictTab])

    await useStore.getState().closeTab(conflictTab.path)

    expect(mockInvoke).toHaveBeenCalledWith(
      'save_file_as',
      expect.objectContaining({
        sourcePath: conflictTab.path,
        filePath: destination,
      })
    )
    expect(useStore.getState().openTabs).toEqual([activeTab])
    expect(useStore.getState().activeFile?.path).toBe(activeTab.path)
  })

  it('never overwrites a recreated stale recovery path', async () => {
    const stalePath = String.raw`C:\Drawings\Recovery.excalidraw`
    const recoveryTab = {
      ...createTab('Recovery.excalidraw', true, [], stalePath),
      recoveryState: 'deleted-on-disk' as const,
    }
    mockInvoke.mockResolvedValueOnce('c:/drawings/RECOVERY.excalidraw')
    setTabs(recoveryTab)

    await expect(useStore.getState().saveCurrentFile()).resolves.toBe(false)

    expect(mockInvoke).not.toHaveBeenCalledWith('save_file', expect.anything())
    expect(mockInvoke).not.toHaveBeenCalledWith('save_file_as', expect.anything())
    expect(useStore.getState().openTabs).toEqual([recoveryTab])
  })

  it('keeps a recovery tab open when close-save is cancelled', async () => {
    const recoveryTab = {
      ...createTab('Recovery.excalidraw', true),
      recoveryState: 'deleted-on-disk' as const,
    }
    vi.mocked(ask).mockResolvedValueOnce(true)
    mockInvoke.mockResolvedValueOnce(null)
    setTabs(recoveryTab)

    await useStore.getState().closeTab(recoveryTab.path)

    expect(useStore.getState().openTabs).toEqual([recoveryTab])
    expect(useStore.getState().activeFile?.path).toBe(recoveryTab.path)
  })

  it('keeps a recovery tab open when close-save writing fails', async () => {
    const recoveryTab = {
      ...createTab('Recovery.excalidraw', true),
      recoveryState: 'deleted-on-disk' as const,
    }
    vi.mocked(ask).mockResolvedValueOnce(true)
    mockInvoke.mockImplementation((command) => {
      if (command === 'select_save_file_path') {
        return Promise.resolve('/recovered/Recovery.excalidraw')
      }
      if (command === 'save_file_as') {
        return Promise.reject(new Error('write failed'))
      }
      return Promise.resolve(undefined)
    })
    setTabs(recoveryTab)

    await useStore.getState().closeTab(recoveryTab.path)

    expect(useStore.getState().openTabs).toEqual([recoveryTab])
    expect(useStore.getState().activeFile?.path).toBe(recoveryTab.path)
  })

  it('saves and closes an inactive recovery without clobbering the clean active tab', async () => {
    const activeTab = createTab('Active.excalidraw')
    const recoveryTab = {
      ...createTab('Recovery.excalidraw', true),
      recoveryState: 'deleted-on-disk' as const,
    }
    vi.mocked(ask).mockResolvedValueOnce(true)
    mockInvoke.mockImplementation((command) => {
      if (command === 'select_save_file_path') {
        return Promise.resolve('/recovered/Recovery.excalidraw')
      }
      if (command === 'save_file_as') {
        return Promise.resolve(saveResult('recovered-hash'))
      }
      return Promise.resolve(undefined)
    })
    setTabs(activeTab, [activeTab, recoveryTab])

    await useStore.getState().closeTab(recoveryTab.path)

    const state = useStore.getState()
    expect(state.openTabs).toEqual([activeTab])
    expect(state.activeFile?.path).toBe(activeTab.path)
    expect(state.fileContent).toBe(activeTab.cachedContent)
    expect(state.isDirty).toBe(false)
  })
})

describe('Save As destination identity', () => {
  it('rekeys only the selected divergent duplicate tab', async () => {
    const first = {
      ...createTab(
        'Duplicate.excalidraw',
        true,
        [{ id: 'first-copy', type: 'rectangle' }]
      ),
      externalConflict: 'modified-on-disk' as const,
    }
    const second = {
      ...createTab(
        first.name,
        true,
        [{ id: 'second-copy', type: 'ellipse' }],
        first.path
      ),
      externalConflict: 'modified-on-disk' as const,
    }
    const destination = '/copies/First duplicate.excalidraw'
    mockInvoke.mockImplementation((command) => {
      if (command === 'select_save_file_path') {
        return Promise.resolve(destination)
      }
      if (command === 'save_file_as') {
        return Promise.resolve(saveResult('first-copy-hash', 'first-copy-identity'))
      }
      if (command === 'get_file_tree') {
        return Promise.resolve([])
      }
      return Promise.resolve(undefined)
    })
    setTabs(first, [first, second])

    await expect(
      useStore.getState().saveTabAs(first.path, undefined, first.tabId)
    ).resolves.toBe(destination)

    expect(useStore.getState().openTabs).toEqual([
      expect.objectContaining({
        tabId: first.tabId,
        path: destination,
        cachedContent: first.cachedContent,
        modified: false,
      }),
      expect.objectContaining({
        tabId: second.tabId,
        path: second.path,
        cachedContent: second.cachedContent,
        modified: true,
        externalConflict: 'modified-on-disk',
      }),
    ])
  })

  it('rejects a recovery destination that is already open before writing', async () => {
    const source = {
      ...createTab(
        'Recovery.excalidraw',
        true,
        [],
        String.raw`C:\Deleted\Recovery.excalidraw`
      ),
      recoveryState: 'deleted-on-disk' as const,
    }
    const destination = createTab(
      'Open.excalidraw',
      false,
      [],
      String.raw`C:\Drawings\Open.excalidraw`
    )
    mockInvoke.mockResolvedValueOnce('c:/drawings/OPEN.excalidraw')
    setTabs(source, [source, destination])

    await expect(useStore.getState().saveTabAs(source.path)).resolves.toBeNull()

    expect(mockInvoke).not.toHaveBeenCalledWith('save_file_as', expect.anything())
    expect(useStore.getState().openTabs).toEqual([source, destination])
  })

  it('rejects a regular destination that is already open before writing', async () => {
    const source = createTab('Source.excalidraw', true)
    const destination = createTab('Destination.excalidraw')
    mockInvoke.mockResolvedValueOnce(destination.path)
    setTabs(source, [source, destination])

    await expect(useStore.getState().saveTabAs(source.path)).resolves.toBeNull()

    expect(mockInvoke).not.toHaveBeenCalledWith('save_file_as', expect.anything())
    expect(useStore.getState().openTabs).toEqual([source, destination])
  })

  it('rechecks destination collisions after the native picker resolves before writing', async () => {
    const source = createTab('Source.excalidraw', true)
    const destination = createTab('Destination.excalidraw')
    let resolveSelection!: (path: string) => void
    let signalPickerStarted!: () => void
    const pickerStarted = new Promise<void>((resolve) => {
      signalPickerStarted = resolve
    })
    mockInvoke.mockImplementation((command) => {
      if (command === 'select_save_file_path') {
        signalPickerStarted()
        return new Promise<string>((resolve) => {
          resolveSelection = resolve
        })
      }
      return Promise.resolve(undefined)
    })
    setTabs(source)

    const saving = useStore.getState().saveTabAs(source.path)
    await pickerStarted
    useStore.setState({ openTabs: [source, destination] })
    resolveSelection(destination.path)

    await expect(saving).resolves.toBeNull()
    expect(mockInvoke).not.toHaveBeenCalledWith('save_file_as', expect.anything())
    expect(useStore.getState().openTabs).toEqual([source, destination])
  })

  it('rejects a concurrent Save As claim before the destination can be written twice', async () => {
    const firstSource = createTab('First.excalidraw', true)
    const secondSource = createTab('Second.excalidraw', true)
    const destination = '/drawings/Shared.excalidraw'
    let resolveFirstSave!: (result: ReturnType<typeof saveResult>) => void
    mockInvoke.mockImplementation((command) => {
      if (command === 'select_save_file_path') {
        return Promise.resolve(destination)
      }
      if (command === 'save_file_as') {
        return new Promise<ReturnType<typeof saveResult>>((resolve) => {
          resolveFirstSave = resolve
        })
      }
      return Promise.resolve(undefined)
    })
    setTabs(firstSource, [firstSource, secondSource])

    const firstSave = useStore.getState().saveTabAs(firstSource.path)
    await vi.waitFor(() =>
      expect(mockInvoke.mock.calls.filter(([command]) => command === 'save_file_as')).toHaveLength(1)
    )

    await expect(
      useStore.getState().saveTabAs(secondSource.path)
    ).resolves.toBeNull()
    expect(
      mockInvoke.mock.calls.filter(([command]) => command === 'save_file_as')
    ).toHaveLength(1)

    resolveFirstSave(saveResult('shared-hash'))
    await expect(firstSave).resolves.toBe(destination)
    expect(useStore.getState().openTabs.map((tab) => tab.path)).toEqual([
      destination,
      secondSource.path,
    ])
  })
})

describe('guarded workspace switching', () => {
  it('preserves a dirty normal tab when workspace switching is cancelled', async () => {
    const dirtyTab = createTab('Dirty.excalidraw', true)
    vi.mocked(ask)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
    setTabs(dirtyTab)

    await expect(
      useStore.getState().loadDirectory('/next-workspace')
    ).resolves.toBe(false)

    const state = useStore.getState()
    expect(state.currentDirectory).toBe('/drawings')
    expect(state.openTabs).toEqual([dirtyTab])
    expect(state.activeFile?.path).toBe(dirtyTab.path)
    expect(mockInvoke).not.toHaveBeenCalledWith('watch_directory', expect.anything())
  })

  it('preserves an inactive recovery beside a clean active tab when switching is cancelled', async () => {
    const activeTab = createTab('Active.excalidraw')
    const recoveryTab = {
      ...createTab('Recovery.excalidraw', true),
      recoveryState: 'deleted-on-disk' as const,
    }
    vi.mocked(ask)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
    setTabs(activeTab, [activeTab, recoveryTab])

    await expect(
      useStore.getState().loadDirectory('/next-workspace')
    ).resolves.toBe(false)

    const state = useStore.getState()
    expect(state.currentDirectory).toBe('/drawings')
    expect(state.openTabs).toEqual([activeTab, recoveryTab])
    expect(state.activeFile?.path).toBe(activeTab.path)
  })

  it('preserves the workspace when recovery Save As fails', async () => {
    const recoveryTab = {
      ...createTab('Recovery.excalidraw', true),
      recoveryState: 'deleted-on-disk' as const,
    }
    vi.mocked(ask).mockResolvedValueOnce(true)
    mockInvoke.mockImplementation((command) => {
      if (command === 'list_excalidraw_files' || command === 'get_file_tree') {
        return Promise.resolve([])
      }
      if (command === 'select_save_file_path') {
        return Promise.resolve('/drawings/Recovered.excalidraw')
      }
      if (command === 'save_file_as') {
        return Promise.reject(new Error('write failed'))
      }
      return Promise.resolve(undefined)
    })
    setTabs(recoveryTab)

    await expect(
      useStore.getState().loadDirectory('/next-workspace')
    ).resolves.toBe(false)

    const state = useStore.getState()
    expect(state.currentDirectory).toBe('/drawings')
    expect(state.openTabs).toEqual([recoveryTab])
    expect(state.activeFile?.path).toBe(recoveryTab.path)
    expect(mockInvoke).toHaveBeenCalledWith(
      'save_file_as',
      expect.objectContaining({
        sourcePath: recoveryTab.path,
        isRecovery: true,
      })
    )
  })

  it('allows an identical queued autosave to resolve before changing workspaces', async () => {
    const dirtyTab = createTab('Dirty.excalidraw', true)
    const saveResolvers: Array<(result: ReturnType<typeof saveResult>) => void> = []
    vi.mocked(ask).mockResolvedValueOnce(true)
    mockInvoke.mockImplementation((command) => {
      if (command === 'save_file') {
        return new Promise<ReturnType<typeof saveResult>>((resolve) => {
          saveResolvers.push(resolve)
        })
      }
      if (command === 'list_excalidraw_files' || command === 'get_file_tree') {
        return Promise.resolve([])
      }
      return Promise.resolve(undefined)
    })
    setTabs(dirtyTab)

    const autosave = useStore.getState().saveCurrentFile()
    await vi.waitFor(() => expect(saveResolvers).toHaveLength(1))
    const switching = useStore.getState().loadDirectory('/next-workspace')
    await vi.waitFor(() =>
      expect(Object.values(useStore.getState().saveOperations)).toEqual([
        dirtyTab.path,
        dirtyTab.path,
      ])
    )

    saveResolvers[0](saveResult('autosave-hash'))
    await expect(autosave).resolves.toBe(true)
    await vi.waitFor(() => expect(saveResolvers).toHaveLength(2))
    saveResolvers[1](saveResult('workspace-save-hash'))

    await expect(switching).resolves.toBe(true)
    expect(useStore.getState().currentDirectory).toBe('/next-workspace')
    expect(useStore.getState().openTabs).toEqual([])
  })

  it('preserves the workspace when recovery Save As is cancelled', async () => {
    const recoveryTab = {
      ...createTab('Recovery.excalidraw', true),
      recoveryState: 'deleted-on-disk' as const,
    }
    vi.mocked(ask).mockResolvedValueOnce(true)
    mockInvoke.mockImplementation((command) => {
      if (command === 'list_excalidraw_files' || command === 'get_file_tree') {
        return Promise.resolve([])
      }
      if (command === 'select_save_file_path') {
        return Promise.resolve(null)
      }
      return Promise.resolve(undefined)
    })
    setTabs(recoveryTab)

    await expect(
      useStore.getState().loadDirectory('/next-workspace')
    ).resolves.toBe(false)

    const state = useStore.getState()
    expect(state.currentDirectory).toBe('/drawings')
    expect(state.openTabs).toEqual([recoveryTab])
    expect(state.activeFile?.path).toBe(recoveryTab.path)
    expect(mockInvoke).not.toHaveBeenCalledWith('save_file_as', expect.anything())
  })

  it('switches workspaces only after every unsaved tab resolves successfully', async () => {
    const dirtyTab = createTab('Dirty.excalidraw', true)
    const recoveryTab = {
      ...createTab('Recovery.excalidraw', true),
      recoveryState: 'deleted-on-disk' as const,
    }
    const recoveryDestination = '/drawings/Recovered.excalidraw'
    vi.mocked(ask)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
    mockInvoke.mockImplementation((command) => {
      if (command === 'save_file') {
        return Promise.resolve(saveResult('saved-hash'))
      }
      if (command === 'select_save_file_path') {
        return Promise.resolve(recoveryDestination)
      }
      if (command === 'save_file_as') {
        return Promise.resolve(saveResult('recovered-hash'))
      }
      if (command === 'list_excalidraw_files' || command === 'get_file_tree') {
        return Promise.resolve([])
      }
      return Promise.resolve(undefined)
    })
    setTabs(dirtyTab, [dirtyTab, recoveryTab])

    await expect(
      useStore.getState().loadDirectory('/next-workspace')
    ).resolves.toBe(true)

    const state = useStore.getState()
    expect(state.currentDirectory).toBe('/next-workspace')
    expect(state.openTabs).toEqual([])
    expect(state.activeFile).toBeNull()
    expect(mockInvoke).toHaveBeenCalledWith('save_file', {
      filePath: dirtyTab.path,
      content: dirtyTab.cachedContent,
      expectedHash: dirtyTab.contentHash,
      expectedIdentity: dirtyTab.fileIdentity,
    })
    expect(mockInvoke).toHaveBeenCalledWith(
      'save_file_as',
      expect.objectContaining({
        filePath: recoveryDestination,
        sourcePath: recoveryTab.path,
        isRecovery: true,
      })
    )
    expect(mockInvoke).toHaveBeenCalledWith('watch_directory', {
      directory: '/next-workspace',
    })
    expect(vi.mocked(ask)).toHaveBeenCalledTimes(2)
  })

  it('resolves edits made while the destination workspace is loading before switching', async () => {
    const cleanTab = createTab('BecomesDirty.excalidraw')
    const changedTab = {
      ...cleanTab,
      modified: true,
      cachedContent: JSON.stringify({
        elements: [{ id: 'edit-during-load', type: 'rectangle' }],
        appState: {},
        files: {},
      }),
      sceneVersion: cleanTab.sceneVersion + 1,
    }
    let resolveFiles!: (files: unknown[]) => void
    const filesPending = new Promise<unknown[]>((resolve) => {
      resolveFiles = resolve
    })
    mockInvoke.mockImplementation((command) => {
      if (command === 'list_excalidraw_files') {
        return filesPending
      }
      if (command === 'get_file_tree') {
        return Promise.resolve([])
      }
      return Promise.resolve(undefined)
    })
    vi.mocked(ask)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
    setTabs(cleanTab)

    const switching = useStore.getState().loadDirectory('/next-workspace')
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('list_excalidraw_files', {
        directory: '/next-workspace',
      })
    })
    useStore.setState({
      activeFile: { ...changedTab },
      fileContent: changedTab.cachedContent,
      isDirty: true,
      openTabs: [changedTab],
    })
    resolveFiles([])

    await expect(switching).resolves.toBe(false)
    const state = useStore.getState()
    expect(state.currentDirectory).toBe('/drawings')
    expect(state.openTabs).toEqual([changedTab])
    expect(state.activeFile?.path).toBe(changedTab.path)
    expect(mockInvoke).not.toHaveBeenCalledWith('watch_directory', expect.anything())
  })
})

describe('destructive deletion preflight', () => {
  beforeEach(() => {
    mockInvoke.mockImplementation((command, args) => {
      if (command === 'get_deletion_scope_matches') {
        return Promise.resolve(deletionScope(args))
      }
      return Promise.resolve(undefined)
    })
  })

  it('resolves divergent same-path tabs by instance without livelocking', async () => {
    const first = {
      ...createTab('Duplicate.excalidraw', true),
      externalConflict: 'modified-on-disk' as const,
    }
    const second = {
      ...createTab(
        first.name,
        true,
        [{ id: 'second-unsaved-copy', type: 'diamond' }],
        first.path
      ),
      externalConflict: 'modified-on-disk' as const,
    }
    vi.mocked(ask)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
    setTabs(first, [first, second])

    await expect(
      useStore.getState().deleteFile(first.path)
    ).resolves.toBe(false)

    expect(vi.mocked(ask)).toHaveBeenCalledTimes(4)
    expect(mockInvoke).not.toHaveBeenCalledWith('delete_file', expect.anything())
    expect(useStore.getState().openTabs).toEqual([first, second])
  })

  it('preflights an inactive dirty file opened through a filesystem alias', async () => {
    const targetPath = '/real/Target.excalidraw'
    const activeTab = createTab('Active.excalidraw')
    const aliasTab = createTab(
      'Target.excalidraw',
      true,
      [{ id: 'alias-local-edit', type: 'rectangle' }],
      '/linked/Target.excalidraw'
    )
    vi.mocked(ask)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    mockInvoke.mockImplementation((command, args) => {
      if (command === 'get_deletion_scope_matches') {
        const candidatePaths = (args as { candidatePaths: string[] }).candidatePaths
        return Promise.resolve(
          candidatePaths.map((path) => path === aliasTab.path)
        )
      }
      if (command === 'get_file_tree') {
        return Promise.resolve([])
      }
      return Promise.resolve(undefined)
    })
    setTabs(activeTab, [activeTab, aliasTab])

    await expect(
      useStore.getState().deleteFile(targetPath)
    ).resolves.toBe(true)

    expect(vi.mocked(ask)).toHaveBeenCalledTimes(2)
    expect(mockInvoke).toHaveBeenCalledWith('delete_file', { filePath: targetPath })
    expect(useStore.getState().openTabs).toEqual([activeTab])
  })

  it('preflights a dirty nested file reached through a folder alias', async () => {
    const folderPath = '/real/Folder'
    const activeTab = createTab('Active.excalidraw')
    const aliasTab = {
      ...createTab(
        'Nested.excalidraw',
        true,
        [{ id: 'folder-alias-edit', type: 'ellipse' }],
        '/linked-folder/Nested.excalidraw'
      ),
      externalConflict: 'modified-on-disk' as const,
    }
    vi.mocked(ask)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    mockInvoke.mockImplementation((command, args) => {
      if (command === 'get_deletion_scope_matches') {
        const candidatePaths = (args as { candidatePaths: string[] }).candidatePaths
        return Promise.resolve(
          candidatePaths.map((path) => path === aliasTab.path)
        )
      }
      if (command === 'get_file_tree') {
        return Promise.resolve([])
      }
      return Promise.resolve(undefined)
    })
    setTabs(activeTab, [activeTab, aliasTab])

    await expect(
      useStore.getState().deleteFolder(folderPath)
    ).resolves.toBe(true)

    expect(vi.mocked(ask)).toHaveBeenCalledTimes(2)
    expect(mockInvoke).toHaveBeenCalledWith('delete_folder', { folderPath })
    expect(useStore.getState().openTabs).toEqual([activeTab])
  })

  it('requires an explicit discard before deleting an active modified file', async () => {
    const modifiedTab = createTab('Modified.excalidraw', true)
    vi.mocked(ask)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    mockInvoke.mockImplementation((command, args) => {
      if (command === 'get_deletion_scope_matches') {
        return Promise.resolve(deletionScope(args))
      }
      if (command === 'get_file_tree') {
        return Promise.resolve([])
      }
      return Promise.resolve(undefined)
    })
    setTabs(modifiedTab)

    await expect(
      useStore.getState().deleteFile(modifiedTab.path)
    ).resolves.toBe(true)

    expect(mockInvoke).toHaveBeenCalledWith('delete_file', {
      filePath: modifiedTab.path,
    })
    expect(useStore.getState().openTabs).toEqual([])
    expect(useStore.getState().activeFile).toBeNull()
  })

  it('saves an inactive disk conflict to a new path before deleting its file', async () => {
    const activeTab = createTab('Active.excalidraw')
    const conflictTab = {
      ...createTab('Conflict.excalidraw', true),
      externalConflict: 'modified-on-disk' as const,
    }
    const destination = '/copies/Conflict.excalidraw'
    vi.mocked(ask).mockResolvedValueOnce(true)
    mockInvoke.mockImplementation((command, args) => {
      if (command === 'get_deletion_scope_matches') {
        return Promise.resolve(deletionScope(args))
      }
      if (command === 'select_save_file_path') {
        return Promise.resolve(destination)
      }
      if (command === 'save_file_as') {
        return Promise.resolve(saveResult('conflict-copy-hash', 'conflict-copy-identity'))
      }
      if (command === 'get_file_tree') {
        return Promise.resolve([])
      }
      return Promise.resolve(undefined)
    })
    setTabs(activeTab, [activeTab, conflictTab])

    await expect(
      useStore.getState().deleteFile(conflictTab.path)
    ).resolves.toBe(true)

    expect(mockInvoke).toHaveBeenCalledWith(
      'save_file_as',
      expect.objectContaining({
        sourcePath: conflictTab.path,
        filePath: destination,
      })
    )
    expect(mockInvoke).toHaveBeenCalledWith('delete_file', {
      filePath: conflictTab.path,
    })
    expect(useStore.getState().openTabs).toEqual([
      activeTab,
      expect.objectContaining({
        path: destination,
        cachedContent: conflictTab.cachedContent,
        modified: false,
        externalConflict: undefined,
      }),
    ])
    expect(useStore.getState().activeFile?.path).toBe(activeTab.path)
  })

  it('aborts file deletion when inactive recovery Save As is cancelled', async () => {
    const activeTab = createTab('Active.excalidraw')
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
        return Promise.resolve(null)
      }
      return Promise.resolve(undefined)
    })
    setTabs(activeTab, [activeTab, recoveryTab])

    await expect(
      useStore.getState().deleteFile(recoveryTab.path)
    ).resolves.toBe(false)

    expect(mockInvoke).not.toHaveBeenCalledWith('delete_file', expect.anything())
    expect(useStore.getState().openTabs).toEqual([activeTab, recoveryTab])
    expect(useStore.getState().activeFile?.path).toBe(activeTab.path)
  })

  it('aborts file deletion when recovery Save As fails', async () => {
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
        return Promise.resolve('/copies/Recovery.excalidraw')
      }
      if (command === 'save_file_as') {
        return Promise.reject(new Error('destination unavailable'))
      }
      return Promise.resolve(undefined)
    })
    setTabs(recoveryTab)

    await expect(
      useStore.getState().deleteFile(recoveryTab.path)
    ).resolves.toBe(false)

    expect(mockInvoke).not.toHaveBeenCalledWith('delete_file', expect.anything())
    expect(useStore.getState().openTabs).toEqual([recoveryTab])
    expect(useStore.getState().activeFile?.path).toBe(recoveryTab.path)
  })

  it('rejects a recovery destination inside the folder being deleted', async () => {
    const folderPath = '/drawings/Folder'
    const activeTab = createTab('Active.excalidraw')
    const recoveryTab = {
      ...createTab(
        'Recovery.excalidraw',
        true,
        [],
        `${folderPath}/Recovery.excalidraw`
      ),
      recoveryState: 'deleted-on-disk' as const,
    }
    vi.mocked(ask).mockResolvedValueOnce(true)
    mockInvoke.mockImplementation((command, args) => {
      if (command === 'get_deletion_scope_matches') {
        return Promise.resolve(deletionScope(args))
      }
      if (command === 'select_save_file_path') {
        return Promise.resolve(`${folderPath}/Recovered.excalidraw`)
      }
      return Promise.resolve(undefined)
    })
    setTabs(activeTab, [activeTab, recoveryTab])

    await expect(
      useStore.getState().deleteFolder(folderPath)
    ).resolves.toBe(false)

    expect(mockInvoke).not.toHaveBeenCalledWith('save_file_as', expect.anything())
    expect(mockInvoke).not.toHaveBeenCalledWith('delete_folder', expect.anything())
    expect(useStore.getState().openTabs).toEqual([activeTab, recoveryTab])
  })

  it('aborts file deletion when saving the modified tab fails', async () => {
    const modifiedTab = createTab('Modified.excalidraw', true)
    vi.mocked(ask).mockResolvedValueOnce(true)
    mockInvoke.mockImplementation((command, args) => {
      if (command === 'get_deletion_scope_matches') {
        return Promise.resolve(deletionScope(args))
      }
      if (command === 'save_file') {
        return Promise.reject(new Error('disk unavailable'))
      }
      return Promise.resolve(undefined)
    })
    setTabs(modifiedTab)

    await expect(
      useStore.getState().deleteFile(modifiedTab.path)
    ).resolves.toBe(false)

    expect(mockInvoke).not.toHaveBeenCalledWith('delete_file', expect.anything())
    expect(useStore.getState().openTabs).toEqual([modifiedTab])
    expect(useStore.getState().activeFile?.path).toBe(modifiedTab.path)
  })

  it('resolves every nested unsaved tab in open-tab order before deleting a folder', async () => {
    const folderPath = '/drawings/Folder'
    const activeTab = createTab('Active.excalidraw')
    const modifiedTab = createTab(
      'Modified.excalidraw',
      true,
      [{ id: 'modified-local', type: 'rectangle' }],
      `${folderPath}/Modified.excalidraw`
    )
    const conflictTab = {
      ...createTab(
        'Conflict.excalidraw',
        true,
        [{ id: 'conflict-local', type: 'ellipse' }],
        `${folderPath}/Nested/Conflict.excalidraw`
      ),
      externalConflict: 'modified-on-disk' as const,
    }
    const recoveryTab = {
      ...createTab(
        'Recovery.excalidraw',
        true,
        [{ id: 'recovery-local', type: 'diamond' }],
        `${folderPath}/Recovery.excalidraw`
      ),
      recoveryState: 'deleted-on-disk' as const,
    }
    const conflictDestination = '/copies/Conflict.excalidraw'
    const recoveryDestination = '/copies/Recovery.excalidraw'
    const saveDestinations = [conflictDestination, recoveryDestination]
    vi.mocked(ask)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
    mockInvoke.mockImplementation((command, args) => {
      if (command === 'get_deletion_scope_matches') {
        return Promise.resolve(deletionScope(args))
      }
      if (command === 'save_file') {
        return Promise.resolve(saveResult('modified-saved-hash'))
      }
      if (command === 'select_save_file_path') {
        return Promise.resolve(saveDestinations.shift() ?? null)
      }
      if (command === 'save_file_as') {
        const filePath = (args as { filePath: string }).filePath
        return Promise.resolve(saveResult(`${filePath}-hash`, `identity:${filePath}`))
      }
      if (command === 'get_file_tree') {
        return Promise.resolve([])
      }
      return Promise.resolve(undefined)
    })
    setTabs(activeTab, [activeTab, modifiedTab, conflictTab, recoveryTab])

    await expect(
      useStore.getState().deleteFolder(folderPath)
    ).resolves.toBe(true)

    expect(vi.mocked(ask).mock.calls.map(([message]) => message)).toEqual([
      expect.stringContaining(modifiedTab.name),
      expect.stringContaining(conflictTab.name),
      expect.stringContaining(recoveryTab.name),
    ])
    expect(mockInvoke).toHaveBeenCalledWith('delete_folder', {
      folderPath,
    })
    expect(
      mockInvoke.mock.calls
        .filter(([command]) => command === 'save_file_as')
        .every(([, args]) =>
          (args as { forbiddenDirectory?: string }).forbiddenDirectory === folderPath
        )
    ).toBe(true)
    expect(useStore.getState().openTabs.map((tab) => tab.path)).toEqual([
      activeTab.path,
      conflictDestination,
      recoveryDestination,
    ])
    expect(useStore.getState().activeFile?.path).toBe(activeTab.path)
  })

  it('rechecks a tab edited while the discard prompts are pending', async () => {
    const modifiedTab = createTab('Prompt-race.excalidraw', true)
    let resolveInitialPrompt!: (value: boolean) => void
    vi.mocked(ask)
      .mockImplementationOnce(() => new Promise<boolean>((resolve) => {
        resolveInitialPrompt = resolve
      }))
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
    setTabs(modifiedTab)

    const deletion = useStore.getState().deleteFile(modifiedTab.path)
    await vi.waitFor(() => expect(resolveInitialPrompt).toBeTypeOf('function'))
    const latestTab = createTab(
      modifiedTab.name,
      true,
      [{ id: 'newer-prompt-edit', type: 'arrow' }],
      modifiedTab.path
    )
    useStore.setState({
      activeFile: latestTab,
      fileContent: latestTab.cachedContent,
      isDirty: true,
      openTabs: [latestTab],
    })
    resolveInitialPrompt(false)

    await expect(deletion).resolves.toBe(false)
    expect(vi.mocked(ask)).toHaveBeenCalledTimes(4)
    expect(mockInvoke).not.toHaveBeenCalledWith('delete_file', expect.anything())
    expect(useStore.getState().openTabs).toEqual([latestTab])
    expect(useStore.getState().fileContent).toBe(latestTab.cachedContent)
  })

  it('preserves a newer edit when the deletion preflight save is pending', async () => {
    const modifiedTab = createTab('Save-race.excalidraw', true)
    let resolveSave!: (result: ReturnType<typeof saveResult>) => void
    vi.mocked(ask).mockResolvedValueOnce(true)
    mockInvoke.mockImplementation((command, args) => {
      if (command === 'get_deletion_scope_matches') {
        return Promise.resolve(deletionScope(args))
      }
      if (command === 'save_file') {
        return new Promise<ReturnType<typeof saveResult>>((resolve) => {
          resolveSave = resolve
        })
      }
      return Promise.resolve(undefined)
    })
    setTabs(modifiedTab)

    const deletion = useStore.getState().deleteFile(modifiedTab.path)
    await vi.waitFor(() => expect(resolveSave).toBeTypeOf('function'))
    const latestTab = createTab(
      modifiedTab.name,
      true,
      [{ id: 'newer-save-edit', type: 'line' }],
      modifiedTab.path
    )
    useStore.setState({
      activeFile: latestTab,
      fileContent: latestTab.cachedContent,
      isDirty: true,
      openTabs: [latestTab],
    })
    resolveSave(saveResult('older-save-hash', modifiedTab.fileIdentity))

    await expect(deletion).resolves.toBe(false)
    expect(mockInvoke).not.toHaveBeenCalledWith('delete_file', expect.anything())
    expect(useStore.getState().openTabs[0]).toEqual(
      expect.objectContaining({
        path: latestTab.path,
        cachedContent: latestTab.cachedContent,
        modified: true,
      })
    )
    expect(useStore.getState().fileContent).toBe(latestTab.cachedContent)
  })
})

describe('post-delete clean fallback validation', () => {
  it('reloads a clean fallback changed during native file deletion', async () => {
    const deletedTab = createTab('Deleted.excalidraw')
    const fallbackTab = createTab('Fallback.excalidraw')
    const changedContent = JSON.stringify({
      elements: [{ id: 'external-file-change', type: 'diamond' }],
      appState: {},
      files: {},
    })
    let diskChanged = false
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
        return Promise.resolve(
          diskChanged
            ? {
                content: changedContent,
                content_hash: 'changed-hash',
                file_identity: fallbackTab.fileIdentity,
              }
            : diskVersion(fallbackTab)
        )
      }
      if (command === 'delete_file') {
        signalDeleteStarted()
        return new Promise<void>((resolve) => {
          resolveDelete = resolve
        })
      }
      return Promise.resolve(undefined)
    })
    setTabs(deletedTab, [deletedTab, fallbackTab])

    const deletion = useStore.getState().deleteFile(deletedTab.path)
    await deleteStarted
    diskChanged = true
    resolveDelete()
    await deletion

    const state = useStore.getState()
    expect(state.activeFile?.path).toBe(fallbackTab.path)
    expect(state.fileContent).toBe(changedContent)
    expect(state.openTabs[0].contentHash).toBe('changed-hash')
    expect(state.openTabs[0].cachedScene.elements).toEqual([
      { id: 'external-file-change', type: 'diamond' },
    ])
  })

  it('reloads a clean fallback changed during native folder deletion', async () => {
    const folderPath = '/drawings/Folder'
    const deletedTab = {
      ...createTab('Deleted.excalidraw'),
      path: `${folderPath}/Deleted.excalidraw`,
    }
    const fallbackTab = createTab('Fallback.excalidraw')
    const changedContent = JSON.stringify({
      elements: [{ id: 'external-folder-change', type: 'ellipse' }],
      appState: {},
      files: {},
    })
    let diskChanged = false
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
        return Promise.resolve(
          diskChanged
            ? {
                content: changedContent,
                content_hash: 'changed-hash',
                file_identity: fallbackTab.fileIdentity,
              }
            : diskVersion(fallbackTab)
        )
      }
      if (command === 'delete_folder') {
        signalDeleteStarted()
        return new Promise<void>((resolve) => {
          resolveDelete = resolve
        })
      }
      return Promise.resolve(undefined)
    })
    setTabs(deletedTab, [deletedTab, fallbackTab])

    const deletion = useStore.getState().deleteFolder(folderPath)
    await deleteStarted
    diskChanged = true
    resolveDelete()
    await deletion

    const state = useStore.getState()
    expect(state.activeFile?.path).toBe(fallbackTab.path)
    expect(state.fileContent).toBe(changedContent)
    expect(state.openTabs[0].contentHash).toBe('changed-hash')
    expect(state.openTabs[0].cachedScene.elements).toEqual([
      { id: 'external-folder-change', type: 'ellipse' },
    ])
  })
})
