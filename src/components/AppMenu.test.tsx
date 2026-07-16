import { fireEvent, render, screen } from '@testing-library/react'
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
      activeFile: {
        kind: 'excalidraw',
        tabId: 'menu-drawing',
        name: 'Menu.excalidraw',
        path: '/work/Menu.excalidraw',
        modified: false,
      },
      sidebarVisible: true,
      preferences: {
        ...state.preferences,
        recentDirectories: ['/work/alpha', '/clients/beta'],
      },
    }))
  })

  it('organizes the desktop commands in an accessible application menu', async () => {
    const user = userEvent.setup()
    render(<AppMenu />)

    await user.click(screen.getByRole('button', {
      name: 'Open application menu',
    }))

    expect(screen.getByRole('menu', { name: 'Open application menu' })).toBeVisible()
    expect(screen.getByText('Create')).toBeVisible()
    expect(screen.getByText('Workspace')).toBeVisible()
    expect(screen.getByText('Document')).toBeVisible()
    expect(screen.getByText('View')).toBeVisible()
    expect(screen.getByRole('menuitem', { name: /New drawing/ })).toBeVisible()
    expect(screen.getByRole('menuitem', { name: /New note/ })).toBeVisible()
    expect(screen.getByRole('menuitem', { name: /Open folder/ })).toBeVisible()
    expect(screen.getByRole('menuitem', { name: /Save As/ })).toBeVisible()
    expect(screen.getByRole('menuitem', { name: /Canvas view/ })).toBeVisible()
    expect(screen.getByRole('menuitem', { name: /Hide sidebar/ })).toBeVisible()
    expect(screen.getByRole('menuitem', { name: /Keyboard shortcuts/ })).toBeVisible()
    expect(screen.getByRole('menuitem', { name: /Quit Rachana/ })).toBeVisible()

    await user.click(screen.getByRole('menuitem', { name: /Save As/ }))
    expect(executeMenuCommand).toHaveBeenCalledWith({ command: 'save_as' })
  })

  it('dispatches the added note and sidebar commands', async () => {
    const user = userEvent.setup()
    render(<AppMenu />)

    await user.click(screen.getByRole('button', { name: 'Open application menu' }))
    await user.click(screen.getByRole('menuitem', { name: /New note/ }))
    expect(executeMenuCommand).toHaveBeenLastCalledWith({ command: 'new_note' })

    await user.click(screen.getByRole('button', { name: 'Open application menu' }))
    await user.click(screen.getByRole('menuitem', { name: /Hide sidebar/ }))
    expect(executeMenuCommand).toHaveBeenLastCalledWith({ command: 'toggle_sidebar' })
  })

  it('shows recent folder context and dispatches the selected path', async () => {
    const user = userEvent.setup()
    render(<AppMenu />)

    await user.click(screen.getByRole('button', { name: 'Open application menu' }))
    await user.click(screen.getByRole('menuitem', { name: /Open recent/ }))

    const recentFolder = await screen.findByTitle('/clients/beta')
    expect(recentFolder).toHaveAttribute('role', 'menuitem')
    expect(recentFolder).toHaveTextContent('beta')
    expect(recentFolder).toHaveTextContent('/clients/beta')

    fireEvent.click(recentFolder)
    expect(executeMenuCommand).toHaveBeenLastCalledWith({
      command: 'recent_dir_1',
      data: { directory: '/clients/beta' },
    })
  })

  it('offers the show-sidebar state and clears recent folders', async () => {
    const user = userEvent.setup()
    useStore.setState({ sidebarVisible: false })
    render(<AppMenu />)

    await user.click(screen.getByRole('button', { name: 'Open application menu' }))
    expect(screen.getByRole('menuitem', { name: /Show sidebar/ })).toBeVisible()
    await user.click(screen.getByRole('menuitem', { name: /Open recent/ }))

    const clearRecent = await screen.findByRole('menuitem', {
      name: 'Clear recent folders',
    })
    fireEvent.click(clearRecent)

    expect(executeMenuCommand).toHaveBeenLastCalledWith({
      command: 'clear_recent',
    })
  })

  it('disables document and canvas commands without a compatible active file', async () => {
    const user = userEvent.setup()
    useStore.setState({ activeFile: null })
    render(<AppMenu />)

    await user.click(screen.getByRole('button', { name: 'Open application menu' }))

    expect(screen.getByRole('menuitem', { name: /^Save / })).toHaveAttribute('data-disabled')
    expect(screen.getByRole('menuitem', { name: /Save As/ })).toHaveAttribute('data-disabled')
    expect(screen.getByRole('menuitem', { name: /Canvas view/ })).toHaveAttribute('data-disabled')
  })

  it('keeps save available but canvas controls disabled for Markdown', async () => {
    const user = userEvent.setup()
    useStore.setState({
      activeFile: {
        kind: 'markdown',
        tabId: 'menu-note',
        name: 'Menu.md',
        path: '/work/Menu.md',
        modified: false,
      },
    })
    render(<AppMenu />)

    await user.click(screen.getByRole('button', { name: 'Open application menu' }))

    expect(screen.getByRole('menuitem', { name: /^Save / })).not.toHaveAttribute('data-disabled')
    expect(screen.getByRole('menuitem', { name: /Canvas view/ })).toHaveAttribute('data-disabled')
  })

  it('omits the recent submenu when history is empty', async () => {
    const user = userEvent.setup()
    useStore.setState((state) => ({
      preferences: {
        ...state.preferences,
        recentDirectories: [],
      },
    }))
    render(<AppMenu />)

    await user.click(screen.getByRole('button', { name: 'Open application menu' }))

    expect(screen.queryByRole('menuitem', { name: /Open recent/ })).not.toBeInTheDocument()
  })
})
