import { describe, expect, it } from 'vitest'
import type { FileTreeNode } from '../types'
import { filterFileTree } from './fileTreeFilter'

const tree: FileTreeNode[] = [
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
  {
    name: 'Archive',
    path: '/drawings/Archive',
    is_directory: true,
    modified: false,
    children: [
      {
        name: 'Old.excalidraw',
        path: '/drawings/Archive/Old.excalidraw',
        is_directory: false,
        modified: false,
      },
    ],
  },
]

describe('filterFileTree', () => {
  it('matches displayed names case-insensitively and preserves ancestor context', () => {
    const result = filterFileTree(tree, 'LAUNCH plan')

    expect(result.matchCount).toBe(1)
    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0].name).toBe('Projects')
    expect(result.nodes[0].children?.[0].name).toBe('Ideas')
    expect(result.nodes[0].children?.[0].children?.map((node) => node.name)).toEqual([
      'Launch Plan.excalidraw',
    ])
    expect(result.nodes[0].children?.[0].children?.[0]).toBe(
      tree[0].children?.[0].children?.[0]
    )
  })

  it('shows the complete subtree of a matching folder', () => {
    const result = filterFileTree(tree, 'ideas')

    expect(result.matchCount).toBe(1)
    expect(result.nodes[0].children?.[0]).toBe(tree[0].children?.[0])
    expect(result.nodes[0].children?.[0].children?.map((node) => node.name)).toEqual([
      'Launch Plan.excalidraw',
      'Notes.excalidraw',
    ])
  })

  it('returns the original hierarchy for a blank query', () => {
    expect(filterFileTree(tree, '   ')).toEqual({ nodes: tree, matchCount: 0 })
  })
})
