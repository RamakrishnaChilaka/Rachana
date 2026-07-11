import { describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore'
import { saveActiveTabAs } from './useMenuHandler'

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
