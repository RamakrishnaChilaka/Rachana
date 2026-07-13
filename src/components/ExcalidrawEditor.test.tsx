import { act, render, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OpenTab } from '../types'
import type { CachedExcalidrawScene } from '../types'
import { useStore } from '../store/useStore'
import { ExcalidrawEditor } from './ExcalidrawEditor'
import { flushPendingEditorScene } from '../lib/editorSceneSync'
import { executeMenuCommand } from '../hooks/useMenuHandler'

const excalidrawHarness = vi.hoisted(() => ({
  activeEffects: 0,
  effectMounts: 0,
  effectCleanups: 0,
  renderCount: 0,
  propsByElementId: new Map<string, {
    excalidrawAPI: (api: unknown) => void
    onChange: (
      elements: readonly unknown[],
      appState: Record<string, unknown>,
      files: Record<string, unknown>
    ) => void
    viewModeEnabled: boolean
    detectScroll: boolean
  }>(),
  props: null as null | {
    initialData: { elements: readonly unknown[] }
    excalidrawAPI: (api: unknown) => void
    onChange: (
      elements: readonly unknown[],
      appState: Record<string, unknown>,
      files: Record<string, unknown>
    ) => void
    viewModeEnabled: boolean
    detectScroll: boolean
  },
}))

vi.mock('@excalidraw/excalidraw', () => ({
  Excalidraw: (props: typeof excalidrawHarness.props) => {
    useEffect(() => {
      excalidrawHarness.activeEffects += 1
      excalidrawHarness.effectMounts += 1
      return () => {
        excalidrawHarness.activeEffects -= 1
        excalidrawHarness.effectCleanups += 1
      }
    }, [])
    excalidrawHarness.renderCount += 1
    excalidrawHarness.props = props
    const firstElement = props?.initialData.elements[0] as
      | { id?: string }
      | undefined
    if (firstElement?.id && props) {
      excalidrawHarness.propsByElementId.set(firstElement.id, props)
    }
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
  it('keeps inactive editors mounted and isolates menu APIs', async () => {
    excalidrawHarness.propsByElementId.clear()
    excalidrawHarness.activeEffects = 0
    excalidrawHarness.effectMounts = 0
    excalidrawHarness.effectCleanups = 0
    const firstTab = createTab([{ id: 'editor-first' }])
    const secondTab: OpenTab = {
      ...createTab([{ id: 'editor-second' }]),
      tabId: 'editor-performance-tab-2',
      name: 'Performance 2.excalidraw',
      path: '/drawings/Performance 2.excalidraw',
      contentHash: 'performance-hash-2',
      fileIdentity: 'performance-identity-2',
    }
    useStore.setState({
      activeFile: firstTab,
      fileContent: firstTab.cachedContent,
      activeFileLoadSource: 'cache',
      isDirty: false,
      openTabs: [firstTab, secondTab],
      presentationMode: false,
    })
    const view = render(<ExcalidrawEditor theme="light" />)

    expect(await view.findAllByTestId('excalidraw')).toHaveLength(2)
    await waitFor(() => {
      expect(excalidrawHarness.activeEffects).toBe(2)
    })
    expect(
      excalidrawHarness.propsByElementId.get('editor-first')?.viewModeEnabled
    ).toBe(false)
    expect(
      excalidrawHarness.propsByElementId.get('editor-first')?.detectScroll
    ).toBe(false)
    expect(
      excalidrawHarness.propsByElementId.get('editor-second')?.viewModeEnabled
    ).toBe(true)
    expect(
      excalidrawHarness.propsByElementId.get('editor-second')?.detectScroll
    ).toBe(false)
    const firstUpdateScene = vi.fn()
    const secondUpdateScene = vi.fn()
    act(() => {
      excalidrawHarness.propsByElementId.get('editor-first')?.excalidrawAPI({
        getAppState: () => ({ zoom: { value: 1 } }),
        updateScene: firstUpdateScene,
        scrollToContent: vi.fn(),
        refresh: vi.fn(),
      })
      excalidrawHarness.propsByElementId.get('editor-second')?.excalidrawAPI({
        getAppState: () => ({ zoom: { value: 1 } }),
        updateScene: secondUpdateScene,
        scrollToContent: vi.fn(),
        refresh: vi.fn(),
      })
    })
    await executeMenuCommand({ command: 'zoom_in' })
    expect(firstUpdateScene).toHaveBeenCalledOnce()
    firstUpdateScene.mockClear()
    await waitFor(() => {
      expect(excalidrawHarness.activeEffects).toBe(2)
    })

    act(() => {
      useStore.setState({
        activeFile: secondTab,
        fileContent: secondTab.cachedContent,
      })
    })

    await waitFor(() => {
      expect(view.getAllByTestId('excalidraw')).toHaveLength(2)
      expect(excalidrawHarness.activeEffects).toBe(2)
      expect(excalidrawHarness.effectMounts).toBe(2)
      expect(excalidrawHarness.effectCleanups).toBe(0)
      expect(
        excalidrawHarness.propsByElementId.get('editor-first')?.viewModeEnabled
      ).toBe(true)
      expect(
        excalidrawHarness.propsByElementId.get('editor-second')?.viewModeEnabled
      ).toBe(false)
    })
    await executeMenuCommand({ command: 'zoom_in' })
    expect(firstUpdateScene).not.toHaveBeenCalled()
    expect(secondUpdateScene).toHaveBeenCalledOnce()
  })

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
