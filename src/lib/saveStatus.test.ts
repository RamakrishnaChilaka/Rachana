import { describe, expect, it } from 'vitest'
import type { OpenTab } from '../types'
import {
  getActiveDocumentSaveStatus,
  isPathSaving,
  rekeySaveOperation,
} from './saveStatus'

let nextTestTabId = 0

function createTab(
  modified = false,
  recoveryState?: OpenTab['recoveryState']
): OpenTab {
  return {
    kind: 'excalidraw',
    tabId: `save-status-tab-${++nextTestTabId}`,
    name: 'Plan.excalidraw',
    path: '/drawings/Plan.excalidraw',
    modified,
    recoveryState,
    cachedContent: '{}',
    contentHash: 'hash',
    cachedScene: { elements: [], appState: {}, files: {} },
    contentVersion: 0,
  }
}

describe('active document save status', () => {
  it('reports each explicit active-document state with saving precedence', () => {
    const clean = createTab()
    const dirty = createTab(true)
    const recovery = createTab(true, 'deleted-on-disk')
    const conflict = {
      ...createTab(true),
      externalConflict: 'modified-on-disk' as const,
    }

    expect(getActiveDocumentSaveStatus(null, [clean], false, {})).toBeNull()
    expect(getActiveDocumentSaveStatus(clean, [clean], false, {})).toBe('Saved')
    expect(getActiveDocumentSaveStatus(dirty, [dirty], true, {})).toBe(
      'Unsaved changes'
    )
    expect(getActiveDocumentSaveStatus(recovery, [recovery], true, {})).toBe(
      'Save As required'
    )
    expect(getActiveDocumentSaveStatus(conflict, [conflict], true, {})).toBe(
      'Changed on disk'
    )
    expect(
      getActiveDocumentSaveStatus(recovery, [recovery], true, {
        'save-1': recovery.path,
      })
    ).toBe('Saving…')
  })

  it('ignores inactive operations and rekeys only the specified operation', () => {
    const tab = createTab()
    const operations = {
      'save-active': tab.path,
      'save-inactive': '/drawings/Other.excalidraw',
    }
    const rekeyed = rekeySaveOperation(
      operations,
      'save-active',
      tab.path,
      '/drawings/Renamed.excalidraw'
    )

    expect(isPathSaving(rekeyed, tab.path)).toBe(false)
    expect(isPathSaving(rekeyed, '/drawings/Renamed.excalidraw')).toBe(true)
    expect(rekeyed['save-inactive']).toBe('/drawings/Other.excalidraw')
  })
})
