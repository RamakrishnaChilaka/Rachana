import { fireEvent, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore'
import { useKeyboardShortcuts } from './useKeyboardShortcuts'

const { executeMenuCommand, saveActiveTabAs } = vi.hoisted(() => ({
  executeMenuCommand: vi.fn(),
  saveActiveTabAs: vi.fn(),
}))

vi.mock('./useMenuHandler', () => ({
  executeMenuCommand,
  saveActiveTabAs,
}))

describe('useKeyboardShortcuts chrome commands', () => {
  beforeEach(() => {
    executeMenuCommand.mockReset()
    saveActiveTabAs.mockReset()
  })

  it('routes Save As without also triggering a regular save', async () => {
    const saveCurrentFile = vi.fn()
    useStore.setState({ saveCurrentFile })
    renderHook(() => useKeyboardShortcuts())

    fireEvent.keyDown(window, {
      key: 's',
      ctrlKey: true,
      shiftKey: true,
    })

    await waitFor(() => expect(saveActiveTabAs).toHaveBeenCalledOnce())
    expect(saveCurrentFile).not.toHaveBeenCalled()
  })

  it('retains full-screen access after removing the native menu bar', async () => {
    renderHook(() => useKeyboardShortcuts())

    fireEvent.keyDown(window, { key: 'F11' })

    await waitFor(() => {
      expect(executeMenuCommand).toHaveBeenCalledWith({ command: 'fullscreen' })
    })
  })
})
