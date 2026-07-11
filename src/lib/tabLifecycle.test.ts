import { describe, expect, it, vi } from 'vitest'
import type { OpenTab } from '../types'
import {
  getAppCloseState,
  getUnsavedTabs,
  handleAppCloseRequest,
  hasUnsavedTabs,
} from './tabLifecycle'

let nextTestTabId = 0

function createTab(path: string, modified = false): OpenTab {
  return {
    tabId: `tab-lifecycle-tab-${++nextTestTabId}`,
    name: path.split('/').pop() || path,
    path,
    modified,
    cachedContent: '{"elements":[]}',
    contentHash: path,
    cachedScene: { elements: [], appState: {}, files: {} },
    sceneVersion: 0,
  }
}

describe('global unsaved tab state', () => {
  it('blocks app close when an inactive recovery tab exists beside a clean active tab', async () => {
    const activeTab = createTab('/drawings/Active.excalidraw')
    const recoveryTab = {
      ...createTab('/drawings/Recovery.excalidraw', true),
      recoveryState: 'deleted-on-disk' as const,
    }

    expect(hasUnsavedTabs([activeTab, recoveryTab])).toBe(true)
    expect(getUnsavedTabs([activeTab, recoveryTab])).toEqual([recoveryTab])
    expect(getAppCloseState([activeTab, recoveryTab], activeTab.path)).toBe(
      'multiple-or-inactive-unsaved'
    )

    const forceClose = vi.fn()
    const notifyBlocked = vi.fn().mockResolvedValue(undefined)
    await expect(handleAppCloseRequest(
      [activeTab, recoveryTab],
      activeTab.path,
      {
        getCurrentState: () => ({
          openTabs: [activeTab, recoveryTab],
          activePath: activeTab.path,
        }),
        confirmSave: vi.fn(),
        confirmDiscard: vi.fn(),
        saveActive: vi.fn(),
        notifyBlocked,
        forceClose,
      }
    )).resolves.toBe(false)
    expect(notifyBlocked).toHaveBeenCalledWith(1)
    expect(forceClose).not.toHaveBeenCalled()
  })

  it('treats an inactive disk conflict as globally unsaved', () => {
    const activeTab = createTab('/drawings/Active.excalidraw')
    const conflictTab = {
      ...createTab('/drawings/Conflict.excalidraw'),
      externalConflict: 'modified-on-disk' as const,
    }

    expect(getUnsavedTabs([activeTab, conflictTab])).toEqual([conflictTab])
    expect(getAppCloseState([activeTab, conflictTab], activeTab.path)).toBe(
      'multiple-or-inactive-unsaved'
    )
  })

  it('keeps the app open when recovery Save As is cancelled or fails', async () => {
    const recoveryTab = {
      ...createTab('/drawings/Recovery.excalidraw', true),
      recoveryState: 'deleted-on-disk' as const,
    }
    const forceClose = vi.fn()

    await expect(handleAppCloseRequest(
      [recoveryTab],
      recoveryTab.path,
      {
        getCurrentState: () => ({
          openTabs: [recoveryTab],
          activePath: recoveryTab.path,
        }),
        confirmSave: vi.fn().mockResolvedValue(true),
        confirmDiscard: vi.fn(),
        saveActive: vi.fn().mockResolvedValue(false),
        notifyBlocked: vi.fn(),
        forceClose,
      }
    )).resolves.toBe(false)
    expect(forceClose).not.toHaveBeenCalled()
  })
})
