import { act, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { OpenTab } from '../types'
import { useStore } from '../store/useStore'
import { ExcalidrawEditor } from './ExcalidrawEditor'

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

function createTab(): OpenTab {
  const cachedContent = JSON.stringify({
    type: 'excalidraw',
    version: 2,
    elements: [],
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
    cachedScene: { elements: [], appState: {}, files: {} },
    sceneVersion: 0,
  }
}

describe('ExcalidrawEditor canvas updates', () => {
  it('ignores viewport-only changes and keeps store writes outside the canvas tree', () => {
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
    render(<ExcalidrawEditor theme="light" />)

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
    expect(JSON.parse(useStore.getState().fileContent ?? '{}').elements)
      .toEqual(changedElements)
    expect(excalidrawHarness.renderCount).toBe(readyRenderCount)
  })
})
