import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPendingEditorContent } from '../lib/editorContentSync'
import { mockInvoke } from '../test/setup'
import { useStore } from '../store/useStore'
import type { MarkdownOpenTab } from '../types'
import { MarkdownEditor } from './MarkdownEditor'

const codeMirrorHarness = vi.hoisted(() => ({
  listener: null as null | ((update: {
    docChanged: boolean
    state: { doc: { toString(): string } }
  }) => void),
  destroy: vi.fn(),
}))

vi.mock('codemirror', () => {
  class EditorView {
    static lineWrapping = {}
    static theme() { return {} }
    static updateListener = {
      of(listener: typeof codeMirrorHarness.listener) {
        codeMirrorHarness.listener = listener
        return {}
      },
    }

    constructor({ parent }: { parent: HTMLElement }) {
      const editor = document.createElement('div')
      editor.className = 'cm-editor'
      parent.append(editor)
    }

    dispatch() {}
    requestMeasure() {}
    destroy() { codeMirrorHarness.destroy() }
  }

  return { basicSetup: {}, EditorView }
})

vi.mock('@codemirror/state', () => ({
  Compartment: class {
    of() { return {} }
    reconfigure() { return {} }
  },
}))

vi.mock('@codemirror/lang-markdown', () => ({
  markdown: () => ({}),
}))

let nextTabId = 0

function createMarkdownTab(
  content = '# Existing',
  contentVersion = 0
): MarkdownOpenTab {
  return {
    kind: 'markdown',
    tabId: `markdown-tab-${++nextTabId}`,
    name: 'Notes.md',
    path: '/drawings/Notes.md',
    modified: false,
    cachedContent: content,
    contentHash: 'markdown-hash',
    fileIdentity: 'markdown-identity',
    contentVersion,
  }
}

function setActiveMarkdownTab(tab: MarkdownOpenTab) {
  useStore.setState({
    currentDirectory: '/drawings',
    activeFile: tab,
    fileContent: tab.cachedContent,
    activeFileLoadSource: 'cache',
    fileTree: [{
      kind: 'markdown',
      name: tab.name,
      path: tab.path,
      is_directory: false,
      modified: false,
    }],
    files: [tab],
    openTabs: [tab],
    isDirty: false,
    presentationMode: false,
  })
}

afterEach(() => {
  vi.useRealTimers()
  codeMirrorHarness.listener = null
  codeMirrorHarness.destroy.mockClear()
})

describe('MarkdownEditor', () => {
  it('buffers edits, marks the tab dirty, and renders a GFM preview', async () => {
    vi.useFakeTimers()
    const tab = createMarkdownTab()
    setActiveMarkdownTab(tab)
    render(<MarkdownEditor theme="light" presentationMode={false} />)

    expect(screen.getByRole('tabpanel', { name: 'Notes.md' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Split' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )

    act(() => {
      codeMirrorHarness.listener?.({
        docChanged: true,
        state: { doc: { toString: () => '# Updated\n\n- [x] shipped' } },
      })
    })

    expect(useStore.getState().isDirty).toBe(true)
    expect(useStore.getState().openTabs[0].modified).toBe(true)
    expect(useStore.getState().fileTree[0].modified).toBe(true)
    expect(screen.getByRole('heading', { name: 'Updated' })).toBeVisible()
    expect(screen.getByRole('checkbox')).toBeChecked()
    expect(useStore.getState().fileContent).toBe('# Existing')

    act(() => vi.advanceTimersByTime(100))

    expect(useStore.getState().fileContent).toBe('# Updated\n\n- [x] shipped')
    expect(useStore.getState().openTabs[0].cachedContent)
      .toBe('# Updated\n\n- [x] shipped')
  })

  it('flushes pending content at a save boundary', () => {
    const tab = createMarkdownTab('before')
    setActiveMarkdownTab(tab)
    render(<MarkdownEditor theme="dark" presentationMode={false} />)

    act(() => {
      codeMirrorHarness.listener?.({
        docChanged: true,
        state: { doc: { toString: () => 'after' } },
      })
      flushPendingEditorContent(tab.tabId)
    })

    expect(useStore.getState().fileContent).toBe('after')
  })

  it('rejects a stale buffered write after disk content replaces the tab', () => {
    const tab = createMarkdownTab('before')
    setActiveMarkdownTab(tab)
    render(<MarkdownEditor theme="light" presentationMode={false} />)

    act(() => {
      codeMirrorHarness.listener?.({
        docChanged: true,
        state: { doc: { toString: () => 'stale edit' } },
      })
      const reloaded: MarkdownOpenTab = {
        ...tab,
        cachedContent: 'disk content',
        contentHash: 'disk-hash',
        contentVersion: tab.contentVersion + 1,
  modified: false,
      }
      useStore.setState({
        activeFile: reloaded,
        fileContent: reloaded.cachedContent,
        openTabs: [reloaded],
        isDirty: false,
      })
      flushPendingEditorContent(tab.tabId)
    })

    expect(useStore.getState().fileContent).toBe('disk content')
    expect(useStore.getState().openTabs[0].cachedContent).toBe('disk content')
  })

  it('flushes buffered text before external reconciliation snapshots', async () => {
    const tab = createMarkdownTab('before')
    setActiveMarkdownTab(tab)
    render(<MarkdownEditor theme="light" presentationMode={false} />)
    mockInvoke.mockResolvedValueOnce({
      content: 'before',
      content_hash: tab.contentHash,
      file_identity: tab.fileIdentity,
    })

    act(() => {
      codeMirrorHarness.listener?.({
        docChanged: true,
        state: { doc: { toString: () => 'pending edit' } },
      })
    })
    await act(async () => {
      await useStore.getState().reconcileActiveFileAfterExternalChange()
    })

    expect(useStore.getState().fileContent).toBe('pending edit')
    expect(useStore.getState().openTabs[0].cachedContent).toBe('pending edit')
  })

  it('does not render raw HTML from local Markdown', () => {
    const tab = createMarkdownTab('<script>window.pwned = true</script>')
    setActiveMarkdownTab(tab)
    const { container } = render(
      <MarkdownEditor theme="light" presentationMode={false} />
    )

    expect(container.querySelector('script')).toBeNull()
  })
})
