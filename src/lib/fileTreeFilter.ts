import type { FileTreeNode } from '../types'
import { drawingDisplayName } from './path'

export interface FileTreeFilterResult {
  nodes: FileTreeNode[]
  matchCount: number
}

function displayedNodeName(node: FileTreeNode): string {
  return node.is_directory ? node.name : drawingDisplayName(node.name)
}

function countMatches(nodes: FileTreeNode[], query: string): number {
  return nodes.reduce((count, node) => {
    const nodeMatches = displayedNodeName(node).toLowerCase().includes(query)
    return count + (nodeMatches ? 1 : 0) + countMatches(node.children ?? [], query)
  }, 0)
}

export function filterFileTree(
  nodes: FileTreeNode[],
  rawQuery: string
): FileTreeFilterResult {
  const query = rawQuery.trim().toLowerCase()
  if (!query) {
    return { nodes, matchCount: 0 }
  }

  let matchCount = 0
  const filteredNodes = nodes.flatMap((node): FileTreeNode[] => {
    const nodeMatches = displayedNodeName(node).toLowerCase().includes(query)
    if (!node.is_directory) {
      if (!nodeMatches) return []

      matchCount += 1
      return [node]
    }

    if (nodeMatches) {
      matchCount += 1 + countMatches(node.children ?? [], query)
      return [node]
    }

    const filteredChildren = filterFileTree(node.children ?? [], query)
    matchCount += filteredChildren.matchCount
    if (filteredChildren.nodes.length === 0) {
      return []
    }

    return [{ ...node, children: filteredChildren.nodes }]
  })

  return { nodes: filteredNodes, matchCount }
}
