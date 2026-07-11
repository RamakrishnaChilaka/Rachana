import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { mockAppWindow } from '../test/setup'
import { useStore } from '../store/useStore'
import { DocumentChrome, WindowResizeHandles } from './WindowChrome'

describe('WindowChrome', () => {
  beforeEach(() => {
    useStore.setState({
      sidebarVisible: false,
      openTabs: [],
      activeFile: null,
      fileContent: null,
      isDirty: false,
      presentationMode: false,
      saveOperations: {},
    })
  })

  it('keeps app, sidebar, document, and window actions in one rail', async () => {
    const user = userEvent.setup()
    render(<DocumentChrome />)

    expect(screen.getByRole('banner', { name: 'Open documents' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Open application menu' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'New drawing' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Show sidebar' }))
    expect(useStore.getState().sidebarVisible).toBe(true)

    await user.click(screen.getByRole('button', { name: 'Close window' }))
    expect(mockAppWindow.close).toHaveBeenCalledOnce()
  })

  it('provides native resize gestures on every frameless edge', async () => {
    const { container } = render(<WindowResizeHandles />)
    const northEast = container.querySelector('.window-resize-north-east')

    expect(northEast).not.toBeNull()
    fireEvent.pointerDown(northEast!, { button: 0 })

    await waitFor(() => {
      expect(mockAppWindow.startResizeDragging).toHaveBeenCalledWith('NorthEast')
    })
  })
})
