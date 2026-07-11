import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TIMING } from '../constants'
import { isPathSaving } from '../lib/saveStatus'
import { mockInvoke, saveResult } from '../test/setup'
import type { OpenTab } from '../types'
import { useStore } from '../store/useStore'
import { useAutoSave } from './useAutoSave'

let nextTestTabId = 0

function createTab(recoveryState?: OpenTab['recoveryState']): OpenTab {
  const cachedContent = JSON.stringify({
    type: 'excalidraw',
    version: 2,
    elements: [],
    appState: {},
    files: {},
  })
  return {
    tabId: `autosave-tab-${++nextTestTabId}`,
    name: 'Plan.excalidraw',
    path: '/drawings/Plan.excalidraw',
    modified: true,
    recoveryState,
    cachedContent,
    contentHash: 'old-hash',
    cachedScene: { elements: [], appState: {}, files: {} },
    sceneVersion: 0,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  useStore.setState({ saveOperations: {} })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useAutoSave', () => {
  it('routes timed saves through the tracked active-file save action', async () => {
    const tab = createTab()
    let resolveSave!: (result: ReturnType<typeof saveResult>) => void
    mockInvoke.mockImplementation((command) => {
      if (command === 'save_file') {
        return new Promise<ReturnType<typeof saveResult>>((resolve) => {
          resolveSave = resolve
        })
      }
      return Promise.resolve(undefined)
    })
    useStore.setState({
      activeFile: tab,
      fileContent: tab.cachedContent,
      isDirty: true,
      openTabs: [tab],
    })
    renderHook(() => useAutoSave())

    await act(async () => {
      await vi.advanceTimersByTimeAsync(TIMING.AUTO_SAVE_INTERVAL)
    })

    expect(mockInvoke).toHaveBeenCalledWith('save_file', {
      filePath: tab.path,
      content: tab.cachedContent,
      expectedHash: tab.contentHash,
      expectedIdentity: tab.fileIdentity,
    })
    expect(isPathSaving(useStore.getState().saveOperations, tab.path)).toBe(true)

    await act(async () => {
      resolveSave(saveResult('saved-hash'))
      await Promise.resolve()
    })

    expect(isPathSaving(useStore.getState().saveOperations, tab.path)).toBe(false)
  })

  it('does not open Save As automatically for a recovery tab', async () => {
    const recoveryTab = createTab('deleted-on-disk')
    useStore.setState({
      activeFile: recoveryTab,
      fileContent: recoveryTab.cachedContent,
      isDirty: true,
      openTabs: [recoveryTab],
    })
    renderHook(() => useAutoSave())

    await act(async () => {
      await vi.advanceTimersByTimeAsync(TIMING.AUTO_SAVE_INTERVAL)
    })

    expect(mockInvoke).not.toHaveBeenCalledWith('select_save_file_path')
    expect(mockInvoke).not.toHaveBeenCalledWith('save_file', expect.anything())
  })

  it('does not overwrite an external conflict automatically', async () => {
    const conflictTab = {
      ...createTab(),
      externalConflict: 'modified-on-disk' as const,
    }
    useStore.setState({
      activeFile: conflictTab,
      fileContent: conflictTab.cachedContent,
      isDirty: true,
      openTabs: [conflictTab],
    })
    renderHook(() => useAutoSave())

    await act(async () => {
      await vi.advanceTimersByTimeAsync(TIMING.AUTO_SAVE_INTERVAL)
    })

    expect(mockInvoke).not.toHaveBeenCalledWith('select_save_file_path')
    expect(mockInvoke).not.toHaveBeenCalledWith('save_file', expect.anything())
  })
})
