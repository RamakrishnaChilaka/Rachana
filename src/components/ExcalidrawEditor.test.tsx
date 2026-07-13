import { act, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OpenTab } from '../types'
import type { CachedExcalidrawScene } from '../types'
import { useStore } from '../store/useStore'
import { ExcalidrawEditor } from './ExcalidrawEditor'
import { flushPendingEditorScene } from '../lib/editorSceneSync'

const excalidrawHarness = vi.hoisted(() => ({
  renderCount: 0,
  props: null as null | {
    excalidrawAPI: (api: unknown) => void
    onChange: (
      elements: readonly unknown[],
      appState: Record<string, unknown>,
      files: Record<string, unknown>
    ) => void
  },
}))

vi.mock('@excalidraw/excalidraw', () => ({
  Excalidraw: (props: typeof excalidrawHarness.props) => {
    excalidrawHarness.renderCount += 1
    excalidrawHarness.props = props
    return <div data-testid="excalidraw" />
  },
}))

function createTab(elements: readonly Record<string, unknown>[] = []): OpenTab {
  const cachedContent = JSON.stringify({
    type: 'excalidraw',
    version: 2,
    elements,
    appState: {},
    files: {},
  })
  return {
    tabId: 'editor-performance-tab',
    name: 'Performance.excalidraw',
    path: '/drawings/Performance.excalidraw',
    modified: false,
    cachedContent,
    contentHash: 'performance-hash',
    fileIdentity: 'performance-identity',
    cachedScene: {
      elements: elements as unknown as CachedExcalidrawScene['elements'],
      appState: {},
      files: {},
    },
    sceneVersion: 0,
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('ExcalidrawEditor canvas updates', () => {
  it('ignores viewport-only changes and buffers document serialization', async () => {
    const tab = createTab()
    excalidrawHarness.renderCount = 0
    excalidrawHarness.props = null
    useStore.setState({
      activeFile: tab,
      fileContent: tab.cachedContent,
      activeFileLoadSource: 'cache',
      isDirty: false,
      openTabs: [tab],
      presentationMode: false,
    })
    const view = render(<ExcalidrawEditor theme="light" />)
    await view.findByTestId('excalidraw')

    act(() => {
      excalidrawHarness.props?.excalidrawAPI({
        scrollToContent: vi.fn(),
        refresh: vi.fn(),
      })
    })
    const readyRenderCount = excalidrawHarness.renderCount

    act(() => {
      excalidrawHarness.props?.onChange(
        tab.cachedScene.elements,
        { zoom: { value: 1.25 } },
        {}
      )
    })
    expect(useStore.getState().fileContent).toBe(tab.cachedContent)
    expect(useStore.getState().isDirty).toBe(false)
    expect(excalidrawHarness.renderCount).toBe(readyRenderCount)

    const changedElements = [{ id: 'new-element', version: 1 }]
    act(() => {
      excalidrawHarness.props?.onChange(changedElements, {}, {})
    })

    expect(useStore.getState().isDirty).toBe(true)
    expect(useStore.getState().fileContent).toBe(tab.cachedContent)
    expect(excalidrawHarness.renderCount).toBe(readyRenderCount)

    act(() => {
      flushPendingEditorScene(tab.tabId)
    })

    expect(JSON.parse(useStore.getState().fileContent ?? '{}').elements)
      .toEqual(changedElements)
    expect(useStore.getState().openTabs[0].cachedScene.elements)
      .toEqual(changedElements)
    expect(excalidrawHarness.renderCount).toBe(readyRenderCount)
  })

  it('serializes the latest scene after the editor becomes idle', async () => {
    const tab = createTab()
    excalidrawHarness.props = null
    useStore.setState({
      activeFile: tab,
      fileContent: tab.cachedContent,
      activeFileLoadSource: 'cache',
      isDirty: false,
      openTabs: [tab],
      presentationMode: false,
    })
    const view = render(<ExcalidrawEditor theme="light" />)
    await view.findByTestId('excalidraw')
    vi.useFakeTimers()

    act(() => {
      excalidrawHarness.props?.excalidrawAPI({
        scrollToContent: vi.fn(),
        refresh: vi.fn(),
      })
      excalidrawHarness.props?.onChange(
        [{ id: 'idle-element', version: 1 }],
        {},
        {}
      )
    })

    act(() => vi.advanceTimersByTime(99))
    expect(useStore.getState().fileContent).toBe(tab.cachedContent)

    act(() => vi.advanceTimersByTime(1))
    expect(JSON.parse(useStore.getState().fileContent ?? '{}').elements)
      .toEqual([{ id: 'idle-element', version: 1 }])
  })

  it('becomes ready after one deferred initial centering task', async () => {
    const tab = createTab([{ id: 'initial-element', version: 1 }])
    excalidrawHarness.props = null
    useStore.setState({
      activeFile: tab,
      fileContent: tab.cachedContent,
      activeFileLoadSource: 'cache',
      isDirty: false,
      openTabs: [tab],
      presentationMode: false,
    })
    const view = render(<ExcalidrawEditor theme="light" />)
    await view.findByTestId('excalidraw')
    vi.useFakeTimers()
    const scrollToContent = vi.fn()

    act(() => {
      excalidrawHarness.props?.excalidrawAPI({
        scrollToContent,
        refresh: vi.fn(),
      })
    })
    expect(view.getByText('Loading canvas...')).toBeInTheDocument()

    act(() => vi.runOnlyPendingTimers())

    expect(scrollToContent).toHaveBeenCalledWith(
      tab.cachedScene.elements,
      { fitToContent: true }
    )
    expect(view.getByText('Loading canvas...')).toBeInTheDocument()

    act(() => {
      excalidrawHarness.props?.onChange(
        tab.cachedScene.elements.map((element) => ({ ...element })),
        {},
        {}
      )
    })

    expect(useStore.getState().isDirty).toBe(false)
    expect(view.queryByText('Loading canvas...')).not.toBeInTheDocument()
  })

  it('does not let a stale editor overwrite a reloaded scene', async () => {
    const tab = createTab()
    excalidrawHarness.props = null
    useStore.setState({
      activeFile: tab,
      fileContent: tab.cachedContent,
      activeFileLoadSource: 'cache',
      isDirty: false,
      openTabs: [tab],
      presentationMode: false,
    })
    const view = render(<ExcalidrawEditor theme="light" />)
    await view.findByTestId('excalidraw')

    act(() => {
      excalidrawHarness.props?.excalidrawAPI({
        scrollToContent: vi.fn(),
        refresh: vi.fn(),
      })
      excalidrawHarness.props?.onChange(
        [{ id: 'stale-element', version: 1 }],
        {},
        {}
      )
    })

    const reloadedContent = JSON.stringify({
      type: 'excalidraw',
      version: 2,
      elements: [{ id: 'disk-element', version: 1 }],
      appState: {},
      files: {},
    })
    const reloadedTab: OpenTab = {
      ...tab,
      cachedContent: reloadedContent,
      cachedScene: {
        elements: [
          { id: 'disk-element', version: 1 },
        ] as unknown as CachedExcalidrawScene['elements'],
        appState: {},
        files: {},
      },
      sceneVersion: tab.sceneVersion + 1,
    }

    act(() => {
      useStore.setState({
        activeFile: reloadedTab,
        fileContent: reloadedContent,
        isDirty: false,
        openTabs: [reloadedTab],
      })
      flushPendingEditorScene(tab.tabId)
    })

    expect(useStore.getState().fileContent).toBe(reloadedContent)
    expect(useStore.getState().openTabs[0].cachedScene.elements)
      .toEqual([{ id: 'disk-element', version: 1 }])
  })
})
