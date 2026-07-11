import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore'
import { AppMenu } from './AppMenu'

const { executeMenuCommand } = vi.hoisted(() => ({
  executeMenuCommand: vi.fn(),
}))

vi.mock('../hooks/useMenuHandler', () => ({
  executeMenuCommand,
}))

describe('AppMenu', () => {
  beforeEach(() => {
    executeMenuCommand.mockReset()
    useStore.setState((state) => ({
      preferences: {
        ...state.preferences,
        recentDirectories: ['/work/alpha'],
      },
    }))
  })

  it('exposes the desktop commands through an accessible compact menu', async () => {
    const user = userEvent.setup()
    render(<AppMenu />)

    await user.click(screen.getByRole('button', {
      name: 'Open application menu',
    }))

    expect(screen.getByRole('menuitem', { name: /New drawing/ })).toBeVisible()
    expect(screen.getByRole('menuitem', { name: /Open folder/ })).toBeVisible()
    expect(screen.getByRole('menuitem', { name: /Save As/ })).toBeVisible()
    expect(screen.getByRole('menuitem', { name: /Canvas view/ })).toBeVisible()
    expect(screen.getByRole('menuitem', { name: /Keyboard shortcuts/ })).toBeVisible()

    await user.click(screen.getByRole('menuitem', { name: /Save As/ }))
    expect(executeMenuCommand).toHaveBeenCalledWith({ command: 'save_as' })
  })
})
