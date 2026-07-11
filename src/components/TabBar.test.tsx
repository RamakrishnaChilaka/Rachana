import { act, render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { OpenTab } from '../types'
import { useStore } from '../store/useStore'
import { TabBar } from './TabBar'

let nextTestTabId = 0

function createTab(
  modified = false,
  recoveryState?: OpenTab['recoveryState']
): OpenTab {
  return {
    tabId: `tab-bar-tab-${++nextTestTabId}`,
    name: 'Plan.excalidraw',
    path: '/drawings/Plan.excalidraw',
    modified,
    recoveryState,
    cachedContent: '{}',
    contentHash: 'hash',
    cachedScene: { elements: [], appState: {}, files: {} },
    sceneVersion: 0,
  }
}

function setActiveTab(
  tab: OpenTab,
  saveOperations: Record<string, string> = {}
) {
  useStore.setState({
    activeFile: tab,
    fileContent: tab.cachedContent,
    isDirty: tab.modified,
    openTabs: [tab],
    saveOperations,
    presentationMode: false,
  })
}

describe('TabBar save status', () => {
  it('renders every active-document state in a polite status region', () => {
    const clean = createTab()
    setActiveTab(clean)
    const { getByRole } = render(<TabBar />)
    const status = getByRole('status', { name: 'Document save status' })

    expect(status).toHaveTextContent('Saved')
    expect(status).toHaveAttribute('aria-live', 'polite')

    const dirty = createTab(true)
    act(() => setActiveTab(dirty))
    expect(status).toHaveTextContent('Unsaved changes')

    const conflict = {
      ...createTab(true),
      externalConflict: 'modified-on-disk' as const,
    }
    act(() => setActiveTab(conflict))
    expect(status).toHaveTextContent('Changed on disk')

    const recovery = createTab(true, 'deleted-on-disk')
    act(() => setActiveTab(recovery))
    expect(status).toHaveTextContent('Save As required')

    act(() => setActiveTab(recovery, { 'save-recovery': recovery.path }))
    expect(status).toHaveTextContent('Saving…')
  })

  it('ignores inactive saves and renders no status without an active document', () => {
    const clean = createTab()
    setActiveTab(clean, { 'save-other': '/drawings/Other.excalidraw' })
    const { getByRole, queryByRole } = render(<TabBar />)

    expect(getByRole('status', { name: 'Document save status' })).toHaveTextContent(
      'Saved'
    )

    act(() => {
      useStore.setState({
        activeFile: null,
        fileContent: null,
        isDirty: false,
      })
    })
    expect(queryByRole('status', { name: 'Document save status' })).toBeNull()
  })
})
