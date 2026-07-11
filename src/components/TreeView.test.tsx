import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TreeView } from './TreeView'
import { useStore } from '../store/useStore'
import type { FileTreeNode } from '../types'
import { filterFileTree } from '../lib/fileTreeFilter'

const tree: FileTreeNode[] = [
  {
    name: 'Parent',
    path: '/drawings/Parent',
    is_directory: true,
    modified: false,
    children: [
      {
        name: 'Child',
        path: '/drawings/Parent/Child',
        is_directory: true,
        modified: false,
        children: [
          {
            name: 'Drawing.excalidraw',
            path: '/drawings/Parent/Child/Drawing.excalidraw',
            is_directory: false,
            modified: false,
          },
        ],
      },
    ],
  },
]

describe('TreeView keyboard navigation', () => {
  it('moves focus between expanded children and their parent', () => {
    useStore.setState({ activeFile: null, isDirty: false, openTabs: [] })
    const { getByTitle } = render(
      <TreeView nodes={tree} onFileClick={vi.fn()} />
    )
    const parent = getByTitle('Parent')
    const child = getByTitle('Child')

    parent.focus()
    fireEvent.keyDown(parent, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(child)

    fireEvent.keyDown(child, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(parent)
  })

  it('expands a collapsed folder before entering it and collapses before moving to its parent', () => {
    useStore.setState({ activeFile: null, isDirty: false, openTabs: [] })
    const { getByTitle } = render(
      <TreeView nodes={tree} onFileClick={vi.fn()} />
    )
    const parent = getByTitle('Parent')
    const child = getByTitle('Child')

    child.focus()
    fireEvent.keyDown(child, { key: 'ArrowRight' })
    const drawing = getByTitle('Drawing.excalidraw')
    expect(document.activeElement).toBe(child)

    fireEvent.keyDown(child, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(drawing)

    fireEvent.keyDown(drawing, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(child)

    fireEvent.keyDown(child, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(child)

    fireEvent.keyDown(child, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(parent)
  })

  it('moves focus to the next surviving sibling when the focused node is removed', () => {
    useStore.setState({ activeFile: null, isDirty: false, openTabs: [] })
    const siblings: FileTreeNode[] = ['First', 'Second', 'Third'].map((name) => ({
      name: `${name}.excalidraw`,
      path: `/drawings/${name}.excalidraw`,
      is_directory: false,
      modified: false,
    }))
    const { getByTitle, rerender } = render(
      <TreeView nodes={siblings} onFileClick={vi.fn()} />
    )

    getByTitle('Second.excalidraw').focus()
    expect(document.activeElement).toBe(getByTitle('Second.excalidraw'))

    rerender(
      <TreeView nodes={[siblings[0], siblings[2]]} onFileClick={vi.fn()} />
    )

    expect(document.activeElement).toBe(getByTitle('Third.excalidraw'))
    expect(getByTitle('Third.excalidraw')).toHaveAttribute('tabindex', '0')
  })

  it('restores focus within the filtered visible set and keeps one tab stop', () => {
    useStore.setState({ activeFile: null, isDirty: false, openTabs: [] })
    const siblings: FileTreeNode[] = ['First', 'Second', 'Third'].map((name) => ({
      name: `${name}.excalidraw`,
      path: `/drawings/${name}.excalidraw`,
      is_directory: false,
      modified: false,
    }))
    const { container, getByTitle, rerender } = render(
      <TreeView nodes={siblings} onFileClick={vi.fn()} />
    )

    getByTitle('Second.excalidraw').focus()
    const filtered = filterFileTree(siblings, 'third').nodes
    rerender(
      <TreeView nodes={filtered} onFileClick={vi.fn()} forceExpanded />
    )

    const survivor = getByTitle('Third.excalidraw')
    expect(document.activeElement).toBe(survivor)
    expect(survivor).toHaveAttribute('tabindex', '0')
    expect(container.querySelectorAll('[role="treeitem"][tabindex="0"]')).toHaveLength(1)
  })

  it('restores expansion choices after forced filtered expansion ends', () => {
    useStore.setState({ activeFile: null, isDirty: false, openTabs: [] })
    const { getByTitle, rerender } = render(
      <TreeView nodes={tree} onFileClick={vi.fn()} />
    )
    const child = getByTitle('Child')
    child.focus()
    fireEvent.keyDown(child, { key: 'ArrowRight' })
    expect(getByTitle('Drawing.excalidraw')).toBeInTheDocument()

    rerender(
      <TreeView
        nodes={filterFileTree(tree, 'drawing').nodes}
        onFileClick={vi.fn()}
        forceExpanded
      />
    )
    rerender(<TreeView nodes={tree} onFileClick={vi.fn()} />)

    expect(getByTitle('Drawing.excalidraw')).toBeInTheDocument()
  })
})
