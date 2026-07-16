import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getActiveDocumentSaveStatus,
  isPathSaving,
} from '../lib/saveStatus'
import { mockAsk as ask, mockInvoke, saveResult } from '../test/setup'
import type { OpenTab } from '../types'
import { useStore } from './useStore'

let nextTestTabId = 0

function createTab(
  name: string,
  modified = false,
  recoveryState?: OpenTab['recoveryState']
): OpenTab {
  const cachedContent = JSON.stringify({
    type: 'excalidraw',
    version: 2,
    elements: [],
    appState: {},
    files: {},
  })
  return {
    kind: 'excalidraw',
    tabId: `save-status-store-tab-${++nextTestTabId}`,
    name,
    path: `/drawings/${name}`,
    modified,
    recoveryState,
    cachedContent,
    contentHash: `${name}-hash`,
    cachedScene: { elements: [], appState: {}, files: {} },
    contentVersion: 0,
  }
}

function setTabs(activeTab: OpenTab, openTabs: OpenTab[] = [activeTab]) {
  useStore.setState({
    currentDirectory: null,
    files: [],
    fileTree: [],
    activeFile: activeTab,
    fileContent: activeTab.cachedContent,
    activeFileLoadSource: 'cache',
    isDirty: activeTab.modified,
    openTabs,
    saveOperations: {},
  })
}

function activeStatus() {
  const state = useStore.getState()
  return getActiveDocumentSaveStatus(
    state.activeFile,
    state.openTabs,
    state.isDirty,
    state.saveOperations
  )
}

beforeEach(() => {
  vi.mocked(ask).mockReset()
  vi.stubGlobal('alert', vi.fn())
})

describe('tracked save operations', () => {
  it('keeps overlapping manual writes tracked until each operation completes', async () => {
    const tab = createTab('Plan.excalidraw', true)
    const resolvers: Array<(result: ReturnType<typeof saveResult>) => void> = []
    mockInvoke.mockImplementation((command) => {
      if (command === 'save_file') {
        return new Promise<ReturnType<typeof saveResult>>((resolve) => {
          resolvers.push(resolve)
        })
      }
      return Promise.resolve(undefined)
    })
    setTabs(tab)

    const firstSave = useStore.getState().saveCurrentFile()
    const secondSave = useStore.getState().saveCurrentFile()
    await vi.waitFor(() => expect(resolvers).toHaveLength(1))

    expect(Object.values(useStore.getState().saveOperations)).toEqual([
      tab.path,
      tab.path,
    ])
    expect(activeStatus()).toBe('Saving…')

    resolvers[0](saveResult('first-hash'))
    await firstSave
    await vi.waitFor(() => expect(resolvers).toHaveLength(2))
    expect(isPathSaving(useStore.getState().saveOperations, tab.path)).toBe(true)

    resolvers[1](saveResult('second-hash'))
    await secondSave
    expect(useStore.getState().saveOperations).toEqual({})
    expect(activeStatus()).toBe('Saved')
  })

  it('serializes newer content behind an older write so stale data cannot land last', async () => {
    const tab = createTab('Plan.excalidraw', true)
    const writes: string[] = []
    const resolvers: Array<(result: ReturnType<typeof saveResult>) => void> = []
    mockInvoke.mockImplementation((command, args) => {
      if (command === 'save_file') {
        writes.push(args.content)
        return new Promise<ReturnType<typeof saveResult>>((resolve) => {
          resolvers.push(resolve)
        })
      }
      return Promise.resolve(undefined)
    })
    setTabs(tab)

    const firstSave = useStore.getState().saveCurrentFile()
    await vi.waitFor(() => expect(resolvers).toHaveLength(1))

    const latestContent = JSON.stringify({
      type: 'excalidraw',
      version: 2,
      elements: [{ id: 'latest-edit' }],
      appState: {},
      files: {},
    })
    useStore.setState({
      activeFile: { ...tab, modified: true },
      fileContent: latestContent,
      isDirty: true,
      openTabs: [{ ...tab, modified: true, cachedContent: latestContent }],
    })
    const secondSave = useStore.getState().saveCurrentFile()

    expect(resolvers).toHaveLength(1)
    expect(Object.values(useStore.getState().saveOperations)).toEqual([
      tab.path,
      tab.path,
    ])

    resolvers[0](saveResult('older-hash'))
    await expect(firstSave).resolves.toBe(false)
    await vi.waitFor(() => expect(resolvers).toHaveLength(2))
    expect(writes).toEqual([tab.cachedContent, latestContent])
    expect(activeStatus()).toBe('Saving…')

    resolvers[1](saveResult('latest-hash'))
    await expect(secondSave).resolves.toBe(true)
    expect(useStore.getState().openTabs[0]).toMatchObject({
      cachedContent: latestContent,
      contentHash: 'latest-hash',
      modified: false,
    })
    expect(activeStatus()).toBe('Saved')
  })

  it('returns to unsaved when content changes during an in-flight write', async () => {
    const tab = createTab('Plan.excalidraw', true)
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
    await vi.waitFor(() => expect(activeStatus()).toBe('Saving…'))
    const latestContent = JSON.stringify({
      type: 'excalidraw',
      version: 2,
      elements: [{ id: 'newer-edit' }],
      appState: {},
      files: {},
    })
    useStore.setState({
      activeFile: { ...tab, modified: true },
      fileContent: latestContent,
      isDirty: true,
      openTabs: [{ ...tab, modified: true, cachedContent: latestContent }],
    })
    resolveSave(saveResult('stale-hash'))

    await expect(saving).resolves.toBe(false)
    expect(activeStatus()).toBe('Unsaved changes')
    expect(useStore.getState().saveOperations).toEqual({})
  })

  it('rejects Save As to a source with an older write in flight', async () => {
    const tab = createTab('Plan.excalidraw', true)
    let resolveSave!: (result: ReturnType<typeof saveResult>) => void
    mockInvoke.mockImplementation((command) => {
      if (command === 'save_file') {
        return new Promise<ReturnType<typeof saveResult>>((resolve) => {
          resolveSave = resolve
        })
      }
      if (command === 'select_save_file_path') {
        return Promise.resolve(tab.path)
      }
      return Promise.resolve(undefined)
    })
    setTabs(tab)

    const saving = useStore.getState().saveCurrentFile()
    await vi.waitFor(() => expect(activeStatus()).toBe('Saving…'))
    const latestContent = JSON.stringify({
      type: 'excalidraw',
      version: 2,
      elements: [{ id: 'save-as-edit' }],
      appState: {},
      files: {},
    })
    useStore.setState({
      activeFile: { ...tab, modified: true },
      fileContent: latestContent,
      isDirty: true,
      openTabs: [{ ...tab, modified: true, cachedContent: latestContent }],
    })

    await expect(useStore.getState().saveTabAs(tab.path)).resolves.toBeNull()
    expect(mockInvoke).not.toHaveBeenCalledWith('save_file_as', expect.anything())

    resolveSave(saveResult('older-hash'))
    await expect(saving).resolves.toBe(false)
    expect(activeStatus()).toBe('Unsaved changes')
  })

  it('does not expose an inactive workspace-resolution save on the active tab', async () => {
    const activeTab = createTab('Active.excalidraw')
    const inactiveTab = createTab('Inactive.excalidraw', true)
    let resolveSave!: (result: ReturnType<typeof saveResult>) => void
    mockInvoke.mockImplementation((command) => {
      if (command === 'save_file') {
        return new Promise<ReturnType<typeof saveResult>>((resolve) => {
          resolveSave = resolve
        })
      }
      return Promise.resolve(undefined)
    })
    setTabs(activeTab, [activeTab, inactiveTab])

    const saving = useStore
      .getState()
      .saveTabForWorkspaceResolution(inactiveTab.path)
    await vi.waitFor(() => {
      expect(
        isPathSaving(useStore.getState().saveOperations, inactiveTab.path)
      ).toBe(true)
    })

    expect(activeStatus()).toBe('Saved')
    resolveSave(saveResult('inactive-hash'))
    await saving
    expect(useStore.getState().saveOperations).toEqual({})
  })

  it('clears failed writes and never starts tracking a cancelled recovery Save As', async () => {
    const dirtyTab = createTab('Dirty.excalidraw', true)
    mockInvoke.mockRejectedValueOnce(new Error('disk unavailable'))
    setTabs(dirtyTab)

    await expect(useStore.getState().saveCurrentFile()).resolves.toBe(false)
    expect(useStore.getState().saveOperations).toEqual({})
    expect(activeStatus()).toBe('Unsaved changes')

    const recoveryTab = createTab(
      'Recovery.excalidraw',
      true,
      'deleted-on-disk'
    )
    mockInvoke.mockResolvedValueOnce(null)
    setTabs(recoveryTab)

    await expect(useStore.getState().saveTabAs(recoveryTab.path)).resolves.toBeNull()
    expect(useStore.getState().saveOperations).toEqual({})
    expect(activeStatus()).toBe('Save As required')
  })

  it('atomically rekeys the active Save As operation before clearing it', async () => {
    const recoveryTab = createTab(
      'Recovery.excalidraw',
      true,
      'deleted-on-disk'
    )
    const destination = '/recovered/Recovered.excalidraw'
    let resolveSave!: (result: ReturnType<typeof saveResult>) => void
    mockInvoke.mockImplementation((command) => {
      if (command === 'select_save_file_path') {
        return Promise.resolve(destination)
      }
      if (command === 'save_file_as') {
        return new Promise<ReturnType<typeof saveResult>>((resolve) => {
          resolveSave = resolve
        })
      }
      return Promise.resolve(undefined)
    })
    setTabs(recoveryTab)
    let observedAtomicRekey = false
    const unsubscribe = useStore.subscribe((state) => {
      if (
        state.activeFile?.path === destination &&
        isPathSaving(state.saveOperations, destination) &&
        !isPathSaving(state.saveOperations, recoveryTab.path)
      ) {
        observedAtomicRekey = true
      }
    })

    try {
      const saving = useStore.getState().saveTabAs(recoveryTab.path)
      await vi.waitFor(() => expect(activeStatus()).toBe('Saving…'))
      resolveSave(saveResult('recovered-hash'))
      await expect(saving).resolves.toBe(destination)
    } finally {
      unsubscribe()
    }

    expect(observedAtomicRekey).toBe(true)
    expect(useStore.getState().activeFile?.path).toBe(destination)
    expect(useStore.getState().saveOperations).toEqual({})
    expect(activeStatus()).toBe('Saved')
  })

  it('rekeys Save As after an older source write updates only disk bookkeeping', async () => {
    const tab = createTab('Plan.excalidraw', true)
    const destination = '/drawings/Plan Copy.excalidraw'
    let resolveRegularSave!: (result: ReturnType<typeof saveResult>) => void
    let resolveSaveAs!: (result: ReturnType<typeof saveResult>) => void
    mockInvoke.mockImplementation((command) => {
      if (command === 'save_file') {
        return new Promise<ReturnType<typeof saveResult>>((resolve) => {
          resolveRegularSave = resolve
        })
      }
      if (command === 'select_save_file_path') {
        return Promise.resolve(destination)
      }
      if (command === 'save_file_as') {
        return new Promise<ReturnType<typeof saveResult>>((resolve) => {
          resolveSaveAs = resolve
        })
      }
      return Promise.resolve(undefined)
    })
    setTabs(tab)

    const regularSave = useStore.getState().saveCurrentFile()
    await vi.waitFor(() => expect(resolveRegularSave).toBeTypeOf('function'))
    const latestContent = JSON.stringify({
      type: 'excalidraw',
      version: 2,
      elements: [{ id: 'copy-edit' }],
      appState: {},
      files: {},
    })
    useStore.setState({
      activeFile: { ...tab, modified: true },
      fileContent: latestContent,
      isDirty: true,
      openTabs: [{ ...tab, modified: true, cachedContent: latestContent }],
    })
    const saveAs = useStore.getState().saveTabAs(tab.path)
    await vi.waitFor(() => expect(resolveSaveAs).toBeTypeOf('function'))

    resolveRegularSave(saveResult('source-write-hash'))
    await expect(regularSave).resolves.toBe(false)
    expect(useStore.getState().openTabs[0]).toMatchObject({
      path: tab.path,
      contentHash: 'source-write-hash',
      modified: true,
    })

    resolveSaveAs(saveResult('copy-hash'))
    await expect(saveAs).resolves.toBe(destination)
    expect(useStore.getState().openTabs[0]).toMatchObject({
      path: destination,
      cachedContent: latestContent,
      contentHash: 'copy-hash',
      modified: false,
    })
    expect(activeStatus()).toBe('Saved')
  })

  it('shows Saving while close waits for the active write', async () => {
    const tab = createTab('Closing.excalidraw', true)
    let resolveSave!: (result: ReturnType<typeof saveResult>) => void
    vi.mocked(ask).mockResolvedValueOnce(true)
    mockInvoke.mockImplementation((command) => {
      if (command === 'save_file') {
        return new Promise<ReturnType<typeof saveResult>>((resolve) => {
          resolveSave = resolve
        })
      }
      return Promise.resolve(undefined)
    })
    setTabs(tab)

    const closing = useStore.getState().closeTab(tab.path)
    await vi.waitFor(() => expect(activeStatus()).toBe('Saving…'))
    resolveSave(saveResult('closing-hash'))
    await closing

    expect(useStore.getState().saveOperations).toEqual({})
    expect(useStore.getState().activeFile).toBeNull()
    expect(activeStatus()).toBeNull()
  })
})
