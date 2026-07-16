import { act, render, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileTreeNode } from '../types'
import { useStore } from '../store/useStore'
import { Sidebar } from './Sidebar'

const {
  createDrawing,
  createMarkdownDocument,
  createWorkspaceFolder,
  selectWorkspace,
} = vi.hoisted(() => ({
  createDrawing: vi.fn(),
  createMarkdownDocument: vi.fn(),
  createWorkspaceFolder: vi.fn(),
  selectWorkspace: vi.fn(),
}))

vi.mock('../lib/workspaceActions', () => ({
  createDrawing,
  createMarkdownDocument,
  createWorkspaceFolder,
  selectWorkspace,
}))

beforeEach(() => {
  createDrawing.mockReset()
  createMarkdownDocument.mockReset()
  createWorkspaceFolder.mockReset()
  selectWorkspace.mockReset()
})

const searchableTree: FileTreeNode[] = [
  {
    name: 'Projects',
    path: '/drawings/Projects',
    is_directory: true,
    modified: false,
    children: [
      {
        name: 'Ideas',
        path: '/drawings/Projects/Ideas',
        is_directory: true,
        modified: false,
        children: [
          {
            name: 'Launch Plan.excalidraw',
            path: '/drawings/Projects/Ideas/Launch Plan.excalidraw',
            is_directory: false,
            modified: false,
          },
          {
            name: 'Notes.excalidraw',
            path: '/drawings/Projects/Ideas/Notes.excalidraw',
            is_directory: false,
            modified: false,
          },
        ],
      },
    ],
  },
]

function setSidebarState(fileTree: FileTreeNode[] = []) {
  useStore.setState((state) => ({
    currentDirectory: '/drawings',
    fileTree,
    activeFile: null,
    preferences: {
      ...state.preferences,
      sidebarWidth: 200,
    },
  }))
}

describe('Sidebar workspace actions', () => {
  it('keeps the compact primary action accessible when its visible label is hidden', () => {
    setSidebarState()

    const { getByLabelText, getByRole } = render(<Sidebar />)
    const sidebar = getByLabelText('Workspace explorer')
    const newDocument = getByRole('button', { name: 'New document' })

    expect(sidebar).toHaveClass('sidebar-panel')
    expect(sidebar).toHaveStyle({ width: '200px' })
    expect(newDocument).toHaveClass('sidebar-primary-action')
    expect(newDocument).toHaveAttribute('aria-label', 'New document')
    expect(within(newDocument).getByText('New')).toHaveClass(
      'sidebar-primary-action-label'
    )
  })

  it('creates drawings and notes from the shared primary action', async () => {
    const user = userEvent.setup()
    setSidebarState(searchableTree)
    const { getByRole } = render(<Sidebar />)
    const trigger = getByRole('button', { name: 'New document' })

    await user.click(trigger)
    await user.click(getByRole('menuitem', { name: 'New drawing' }))
    expect(createDrawing).toHaveBeenCalledOnce()

    await user.click(trigger)
    await user.click(getByRole('menuitem', { name: 'New note' }))
    expect(createMarkdownDocument).toHaveBeenCalledOnce()
  })

  it('reveals and focuses an ancestor-preserving file filter', async () => {
    const user = userEvent.setup()
    setSidebarState(searchableTree)
    const { getByLabelText, getByRole, getByTitle, queryByTitle } = render(
      <Sidebar />
    )

    await user.click(getByRole('button', { name: 'Search workspace files' }))
    const input = getByLabelText('Filter workspace files')
    expect(input).toHaveFocus()

    await user.type(input, 'launch PLAN')

    expect(getByTitle('Projects')).toBeInTheDocument()
    expect(getByTitle('Ideas')).toBeInTheDocument()
    expect(getByTitle('Launch Plan.excalidraw')).toBeInTheDocument()
    expect(queryByTitle('Notes.excalidraw')).not.toBeInTheDocument()
    expect(getByRole('status')).toHaveTextContent('1 result')
  })

  it('clears on the first Escape and closes on the second', async () => {
    const user = userEvent.setup()
    setSidebarState(searchableTree)
    const { getByLabelText, getByRole, queryByLabelText } = render(<Sidebar />)
    const toggle = getByRole('button', { name: 'Search workspace files' })

    await user.click(toggle)
    const input = getByLabelText('Filter workspace files')
    await user.type(input, 'missing')
    await user.keyboard('{Escape}')

    expect(input).toHaveValue('')
    expect(input).toHaveFocus()

    await user.keyboard('{Escape}')

    expect(queryByLabelText('Filter workspace files')).not.toBeInTheDocument()
    expect(toggle).toHaveFocus()
  })

  it('offers a focused clear action from the no-results state', async () => {
    const user = userEvent.setup()
    setSidebarState(searchableTree)
    const { getByLabelText, getByRole, getByText } = render(<Sidebar />)

    await user.click(getByRole('button', { name: 'Search workspace files' }))
    const input = getByLabelText('Filter workspace files')
    await user.type(input, 'no such drawing')

    expect(getByText('No matching files or folders')).toBeInTheDocument()
    await user.click(getByRole('button', { name: 'Clear filter' }))

    expect(input).toHaveValue('')
    expect(input).toHaveFocus()
    expect(getByRole('tree', { name: 'Workspace files' })).toBeInTheDocument()
  })

  it('preserves folder expansion choices through a no-results filter', async () => {
    const user = userEvent.setup()
    setSidebarState(searchableTree)
    const { getByLabelText, getByRole, getByTitle, queryByTitle } = render(
      <Sidebar />
    )

    await user.click(getByTitle('Projects'))
    expect(queryByTitle('Ideas')).not.toBeInTheDocument()

    await user.click(getByRole('button', { name: 'Search workspace files' }))
    const input = getByLabelText('Filter workspace files')
    await user.type(input, 'not in this workspace')
    await user.click(getByRole('button', { name: 'Clear filter' }))

    expect(getByTitle('Projects')).toHaveAttribute('aria-expanded', 'false')
    expect(queryByTitle('Ideas')).not.toBeInTheDocument()
  })

  it('returns focus to the filter when a focused result disappears', async () => {
    const user = userEvent.setup()
    setSidebarState(searchableTree)
    const { getByLabelText, getByRole, getByTitle } = render(<Sidebar />)

    await user.click(getByRole('button', { name: 'Search workspace files' }))
    const input = getByLabelText('Filter workspace files')
    await user.type(input, 'launch')
    const result = getByTitle('Launch Plan.excalidraw')
    result.focus()
    expect(result).toHaveFocus()

    act(() => {
      setSidebarState([
        {
          ...searchableTree[0],
          children: [
            {
              ...searchableTree[0].children![0],
              children: [searchableTree[0].children![0].children![1]],
            },
          ],
        },
      ])
    })

    expect(getByRole('button', { name: 'Clear filter' })).toBeInTheDocument()
    expect(input).toHaveFocus()
  })

  it('does not steal focus after focus intentionally leaves the filtered tree', async () => {
    const user = userEvent.setup()
    setSidebarState(searchableTree)
    const { getByLabelText, getByRole, getByTitle } = render(<Sidebar />)

    await user.click(getByRole('button', { name: 'Search workspace files' }))
    await user.type(getByLabelText('Filter workspace files'), 'launch')
    getByTitle('Launch Plan.excalidraw').focus()
    const newDocument = getByRole('button', { name: 'New document' })
    newDocument.focus()

    act(() => {
      setSidebarState([])
    })

    expect(newDocument).toHaveFocus()
  })
})
