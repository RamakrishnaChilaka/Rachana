import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenTab } from '../types'
import { useStore } from '../store/useStore'
import { TabBar } from './TabBar'

const { createDrawing, createMarkdownDocument } = vi.hoisted(() => ({
  createDrawing: vi.fn(),
  createMarkdownDocument: vi.fn(),
}))

vi.mock('../lib/workspaceActions', () => ({
  createDrawing,
  createMarkdownDocument,
}))

let nextTestTabId = 0

beforeEach(() => {
  createDrawing.mockReset()
  createMarkdownDocument.mockReset()
  useStore.setState({
    activeFile: null,
    fileContent: null,
    isDirty: false,
    openTabs: [],
    presentationMode: false,
    saveOperations: {},
  })
})

function createTab(
  modified = false,
  recoveryState?: OpenTab['recoveryState']
): OpenTab {
  return {
    kind: 'excalidraw',
    tabId: `tab-bar-tab-${++nextTestTabId}`,
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

describe('TabBar document creation', () => {
  it('offers both document kinds from one generic trigger', async () => {
    const user = userEvent.setup()
    render(<TabBar />)

    const trigger = screen.getByRole('button', { name: 'New document' })
    expect(screen.queryByRole('button', { name: 'New drawing' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'New note' })).toBeNull()

    await user.click(trigger)
    await user.click(screen.getByRole('menuitem', { name: 'New drawing' }))
    expect(createDrawing).toHaveBeenCalledOnce()
    expect(createMarkdownDocument).not.toHaveBeenCalled()

    await user.click(trigger)
    await user.click(screen.getByRole('menuitem', { name: 'New note' }))
    expect(createMarkdownDocument).toHaveBeenCalledOnce()
  })

  it('supports keyboard creation and hides the trigger in presentation mode', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<TabBar />)
    const trigger = screen.getByRole('button', { name: 'New document' })

    trigger.focus()
    await user.keyboard('{Enter}{ArrowDown}{Enter}')
    expect(createMarkdownDocument).toHaveBeenCalledOnce()

    act(() => useStore.setState({ presentationMode: true }))
    rerender(<TabBar />)
    expect(screen.queryByRole('button', { name: 'New document' })).toBeNull()
  })
})
