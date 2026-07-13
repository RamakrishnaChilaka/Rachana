import { afterEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore'
import { mockAppWindow } from '../test/setup'
import {
  executeMenuCommand,
  registerEditorExcalidrawAPI,
  saveActiveTabAs,
} from './useMenuHandler'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'

afterEach(() => {
  vi.useRealTimers()
})

describe('menu Save As', () => {
  it('targets the active tab instance when duplicate paths are open', async () => {
    const saveTabAs = vi.fn().mockResolvedValue(true)
    useStore.setState({
      activeFile: {
        tabId: 'duplicate-tab-2',
        name: 'Duplicate.excalidraw',
        path: '/drawings/Duplicate.excalidraw',
        modified: true,
      },
      saveTabAs,
    })

    await saveActiveTabAs()

    expect(saveTabAs).toHaveBeenCalledWith(
      '/drawings/Duplicate.excalidraw',
      undefined,
      'duplicate-tab-2'
    )
  })
})

describe('canvas menu commands', () => {
  it('keeps a newer API registered when a stale cleanup runs', async () => {
    const staleUpdateScene = vi.fn()
    const activeUpdateScene = vi.fn()
    const staleAPI = {
      getAppState: () => ({ zoom: { value: 1 } }),
      updateScene: staleUpdateScene,
    } as unknown as ExcalidrawImperativeAPI
    const activeAPI = {
      getAppState: () => ({ zoom: { value: 1 } }),
      updateScene: activeUpdateScene,
    } as unknown as ExcalidrawImperativeAPI
    const unregisterStale = registerEditorExcalidrawAPI('menu-tab', staleAPI)
    const unregisterActive = registerEditorExcalidrawAPI('menu-tab', activeAPI)
    useStore.setState({
      activeFile: {
        tabId: 'menu-tab',
        name: 'Menu.excalidraw',
        path: '/drawings/Menu.excalidraw',
        modified: false,
      },
    })

    unregisterStale()
    await executeMenuCommand({ command: 'zoom_in' })

    expect(staleUpdateScene).not.toHaveBeenCalled()
    expect(activeUpdateScene).toHaveBeenCalledOnce()
    unregisterActive()
  })

  it('refreshes the active tab and skips a stale delayed scroll', async () => {
    vi.useFakeTimers()
    const firstRefresh = vi.fn()
    const secondRefresh = vi.fn()
    const secondScrollToContent = vi.fn()
    const firstAPI = {
      refresh: firstRefresh,
      getSceneElements: () => [],
    } as unknown as ExcalidrawImperativeAPI
    const secondAPI = {
      refresh: secondRefresh,
      getSceneElements: () => [{ id: 'second-element' }],
      scrollToContent: secondScrollToContent,
    } as unknown as ExcalidrawImperativeAPI
    const unregisterFirst = registerEditorExcalidrawAPI('fullscreen-1', firstAPI)
    const unregisterSecond = registerEditorExcalidrawAPI('fullscreen-2', secondAPI)
    mockAppWindow.isFullscreen.mockResolvedValue(false)
    useStore.setState({
      activeFile: {
        tabId: 'fullscreen-1',
        name: 'First.excalidraw',
        path: '/drawings/First.excalidraw',
        modified: false,
      },
    })

    await executeMenuCommand({ command: 'fullscreen' })
    useStore.setState({
      activeFile: {
        tabId: 'fullscreen-2',
        name: 'Second.excalidraw',
        path: '/drawings/Second.excalidraw',
        modified: false,
      },
    })
    await vi.advanceTimersByTimeAsync(300)

    expect(firstRefresh).not.toHaveBeenCalled()
    expect(secondRefresh).toHaveBeenCalledOnce()

    useStore.setState({
      activeFile: {
        tabId: 'fullscreen-1',
        name: 'First.excalidraw',
        path: '/drawings/First.excalidraw',
        modified: false,
      },
    })
    await vi.advanceTimersByTimeAsync(100)

    expect(secondScrollToContent).not.toHaveBeenCalled()
    unregisterFirst()
    unregisterSecond()
  })
})
