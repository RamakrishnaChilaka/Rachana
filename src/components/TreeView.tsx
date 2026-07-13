import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  ChevronDown,
  ChevronRight,
  Edit2,
  File,
  FilePlus,
  Folder,
  FolderOpen,
  FolderPlus,
  MoreHorizontal,
  Trash2,
} from 'lucide-react'
import { cn } from '../lib/utils'
import { getNativeApi } from '../lib/native'
import { drawingDisplayName } from '../lib/path'
import { promptForName } from '../lib/namePrompt'
import {
  DeletionFallbackValidationError,
  DeletionRecoveryError,
  useStore,
} from '../store/useStore'
import type { FileTreeNode } from '../types'

interface TreeViewProps {
  nodes: FileTreeNode[]
  onFileClick: (node: FileTreeNode) => void
  activeFilePath?: string
  forceExpanded?: boolean
}

interface TreeNodeProps extends Omit<TreeViewProps, 'nodes'> {
  node: FileTreeNode
  depth: number
  initialTabStop: boolean
  parentPath: string | null
  onItemFocus: (path: string, item: HTMLElement) => void
  expansionByPath: ReadonlyMap<string, boolean>
  onExpansionChange: (path: string, expanded: boolean) => void
}

interface TreeFocusRecord {
  path: string
  parentPath: string | null
  siblingPaths: string[]
  siblingIndex: number
}

function displayName(node: FileTreeNode): string {
  return node.is_directory ? node.name : drawingDisplayName(node.name)
}

const TreeNode = memo(function TreeNode({
  node,
  onFileClick,
  activeFilePath,
  depth,
  initialTabStop,
  parentPath,
  onItemFocus,
  forceExpanded = false,
  expansionByPath,
  onExpansionChange,
}: TreeNodeProps) {
  const [isRenaming, setIsRenaming] = useState(false)
  const [newName, setNewName] = useState(displayName(node))
  const [menuOpen, setMenuOpen] = useState(false)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const cancelRenameRef = useRef(false)
  const keepRenameFocusRef = useRef(false)
  const createNewFile = useStore((state) => state.createNewFile)
  const createNewFolder = useStore((state) => state.createNewFolder)
  const renameFile = useStore((state) => state.renameFile)
  const renameFolder = useStore((state) => state.renameFolder)
  const deleteFile = useStore((state) => state.deleteFile)
  const deleteFolder = useStore((state) => state.deleteFolder)

  useEffect(() => {
    if (isRenaming) {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    }
  }, [isRenaming])

  useEffect(() => {
    if (!isRenaming) {
      setNewName(displayName(node))
    }
  }, [isRenaming, node])

  const activateNode = () => {
    if (node.is_directory) {
      if (!forceExpanded) {
        onExpansionChange(node.path, !isExpanded)
      }
    } else {
      onFileClick(node)
    }
  }

  const isExpanded = forceExpanded || (expansionByPath.get(node.path) ?? depth === 0)

  const handleRowKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) {
      return
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      const tree = event.currentTarget.closest('[role="tree"]')
      const items = Array.from(tree?.querySelectorAll<HTMLElement>('[role="treeitem"]') || [])
      const currentIndex = items.indexOf(event.currentTarget)
      const nextIndex = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : event.key === 'ArrowDown'
            ? Math.min(items.length - 1, currentIndex + 1)
            : Math.max(0, currentIndex - 1)
      items[nextIndex]?.focus()
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      activateNode()
    } else if (node.is_directory && event.key === 'ArrowRight') {
      event.preventDefault()
      if (isExpanded) {
        const childGroup = event.currentTarget.nextElementSibling
        if (childGroup?.getAttribute('role') === 'group') {
          childGroup.querySelector<HTMLElement>('[role="treeitem"]')?.focus()
        }
      } else {
        onExpansionChange(node.path, true)
      }
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      if (node.is_directory && isExpanded && !forceExpanded) {
        onExpansionChange(node.path, false)
      } else {
        const nodeWrapper = event.currentTarget.parentElement
        const parentGroup = nodeWrapper?.parentElement
        if (parentGroup?.getAttribute('role') === 'group') {
          const parentItem = parentGroup.previousElementSibling
          if (parentItem?.getAttribute('role') === 'treeitem') {
            (parentItem as HTMLElement).focus()
          }
        }
      }
    }
  }

  const handleRename = async () => {
    if (cancelRenameRef.current) {
      cancelRenameRef.current = false
      setNewName(displayName(node))
      setIsRenaming(false)
      return
    }

    const finalName = newName.trim()
    if (finalName && finalName !== displayName(node)) {
      if (node.is_directory) {
        await renameFolder(node.path, finalName)
      } else {
        await renameFile(node.path, finalName)
      }
    }
    setNewName(finalName || displayName(node))
    setIsRenaming(false)
  }

  const handleCreateFile = async () => {
    const fileName = await promptForName({
      title: 'Drawing name',
      defaultValue: 'Untitled.excalidraw',
      confirmLabel: 'Create drawing',
    })
    if (!fileName) return

    await createNewFile(fileName, node.path)
    onExpansionChange(node.path, true)
  }

  const handleCreateFolder = async () => {
    const folderName = await promptForName({
      title: 'Folder name',
      defaultValue: 'New Folder',
      confirmLabel: 'Create folder',
    })
    if (!folderName) return

    await createNewFolder(folderName, node.path)
    onExpansionChange(node.path, true)
  }

  const handleDelete = async () => {
    const itemName = displayName(node)
    try {
      const confirmed = await getNativeApi().dialogs.ask(`Are you sure you want to delete "${itemName}"?`, {
        title: 'Confirm Deletion',
        kind: 'warning',
        okLabel: 'Delete',
        cancelLabel: 'Cancel',
      })
      if (!confirmed) return

      if (node.is_directory) {
        await deleteFolder(node.path)
      } else {
        await deleteFile(node.path)
      }
    } catch (error) {
      console.error('Failed to delete item:', error)
      const isDeletionWarning =
        error instanceof DeletionFallbackValidationError ||
        error instanceof DeletionRecoveryError
      const errorMessage = isDeletionWarning
        ? error.message
        : `Failed to delete item: ${error}`
      try {
        await getNativeApi().dialogs.message(errorMessage, {
          title: isDeletionWarning ? 'Deletion Completed' : 'Error',
          kind: isDeletionWarning ? 'warning' : 'error',
        })
      } catch (messageError) {
        console.error('Failed to show deletion error:', messageError)
      }
    }
  }

  const handleContextMenu = (event: MouseEvent) => {
    event.preventDefault()
    setMenuOpen(true)
  }

  const isActive = activeFilePath === node.path
  const hasChildren = Boolean(node.children?.length)
  const name = displayName(node)

  return (
    <div className="tree-node-wrap">
      <div
        className={cn('tree-node', isActive && 'active')}
        style={{ paddingLeft: `${0.375 + depth * 0.875}rem` }}
        role="treeitem"
        aria-level={depth + 1}
        aria-expanded={node.is_directory ? isExpanded : undefined}
        aria-selected={!node.is_directory ? isActive : undefined}
        tabIndex={initialTabStop ? 0 : -1}
        data-tree-path={node.path}
        data-parent-path={parentPath ?? ''}
        title={node.name}
        onClick={activateNode}
        onFocus={(event) => {
          if (event.target === event.currentTarget) {
            onItemFocus(node.path, event.currentTarget)
          }
        }}
        onKeyDown={handleRowKeyDown}
        onContextMenu={handleContextMenu}
      >
        <span className="tree-chevron" aria-hidden="true">
          {node.is_directory && hasChildren && (
            isExpanded ? <ChevronDown /> : <ChevronRight />
          )}
        </span>

        {node.is_directory ? (
          isExpanded
            ? <FolderOpen className="tree-folder-icon" aria-hidden="true" />
            : <Folder className="tree-folder-icon" aria-hidden="true" />
        ) : (
          <File className="tree-file-icon" aria-hidden="true" />
        )}

        {isRenaming ? (
          <input
            ref={renameInputRef}
            className="tree-input"
            value={newName}
            aria-label={`Rename ${name}`}
            onChange={(event) => setNewName(event.target.value)}
            onBlur={() => void handleRename()}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === 'Enter') {
                void handleRename()
              } else if (event.key === 'Escape') {
                cancelRenameRef.current = true
                setNewName(displayName(node))
                setIsRenaming(false)
              }
            }}
          />
        ) : (
          <span className={cn('tree-label', node.modified && 'modified')}>{name}</span>
        )}

        {node.modified && (
          <>
            <span className="modified-dot" aria-hidden="true" />
            <span className="sr-only">Unsaved changes</span>
          </>
        )}

        <DropdownMenu.Root open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenu.Trigger asChild>
            <button
              className="tree-actions-trigger"
              aria-label={`${node.is_directory ? 'Folder' : 'Drawing'} actions for ${name}`}
              title={`${node.is_directory ? 'Folder' : 'Drawing'} actions`}
              onClick={(event) => event.stopPropagation()}
            >
              <MoreHorizontal aria-hidden="true" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className="tree-menu"
              sideOffset={4}
              align="end"
              onCloseAutoFocus={(event) => {
                if (!keepRenameFocusRef.current) return

                event.preventDefault()
                keepRenameFocusRef.current = false
                window.requestAnimationFrame(() => {
                  renameInputRef.current?.focus()
                  renameInputRef.current?.select()
                })
              }}
            >
              {node.is_directory && (
                <>
                  <DropdownMenu.Item
                    className="tree-menu-item"
                    onSelect={() => {
                      window.setTimeout(() => void handleCreateFile(), 0)
                    }}
                  >
                    <FilePlus aria-hidden="true" />
                    New drawing
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    className="tree-menu-item"
                    onSelect={() => {
                      window.setTimeout(() => void handleCreateFolder(), 0)
                    }}
                  >
                    <FolderPlus aria-hidden="true" />
                    New folder
                  </DropdownMenu.Item>
                  <DropdownMenu.Separator className="tree-menu-separator" />
                </>
              )}
              <DropdownMenu.Item
                className="tree-menu-item"
                onSelect={() => {
                  cancelRenameRef.current = false
                  keepRenameFocusRef.current = true
                  setIsRenaming(true)
                }}
              >
                <Edit2 aria-hidden="true" />
                Rename
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className="tree-menu-item danger"
                onSelect={() => void handleDelete()}
              >
                <Trash2 aria-hidden="true" />
                Delete
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>

      {node.is_directory && hasChildren && isExpanded && (
        <div role="group">
          {node.children!.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              onFileClick={onFileClick}
              activeFilePath={activeFilePath}
              depth={depth + 1}
              initialTabStop={false}
              parentPath={node.path}
              onItemFocus={onItemFocus}
              forceExpanded={forceExpanded}
              expansionByPath={expansionByPath}
              onExpansionChange={onExpansionChange}
            />
          ))}
        </div>
      )}
    </div>
  )
})

export function TreeView({
  nodes,
  onFileClick,
  activeFilePath,
  forceExpanded = false,
}: TreeViewProps) {
  const treeRef = useRef<HTMLDivElement>(null)
  const focusRecordRef = useRef<TreeFocusRecord | null>(null)
  const treeHasFocusRef = useRef(false)
  const [expansionByPath, setExpansionByPath] = useState<ReadonlyMap<string, boolean>>(
    () => new Map()
  )

  const handleExpansionChange = useCallback((path: string, expanded: boolean) => {
    setExpansionByPath((current) => {
      const next = new Map(current)
      next.set(path, expanded)
      return next
    })
  }, [])

  const setRovingItem = useCallback((item: HTMLElement, treeHasFocus: boolean) => {
    const tree = treeRef.current
    if (!tree) return

    const items = Array.from(tree.querySelectorAll<HTMLElement>('[data-tree-path]'))
    items.forEach((treeItem) => {
      treeItem.tabIndex = treeItem === item ? 0 : -1
    })

    const parentPath = item.dataset.parentPath || null
    const siblings = items.filter(
      (treeItem) => (treeItem.dataset.parentPath || null) === parentPath
    )
    focusRecordRef.current = {
      path: item.dataset.treePath || '',
      parentPath,
      siblingPaths: siblings.map((treeItem) => treeItem.dataset.treePath || ''),
      siblingIndex: siblings.indexOf(item),
    }
    if (treeHasFocus) {
      treeHasFocusRef.current = true
    }
  }, [])

  const handleItemFocus = useCallback((_path: string, item: HTMLElement) => {
    setRovingItem(item, true)
  }, [setRovingItem])

  useEffect(() => {
    const handleDocumentFocus = (event: FocusEvent) => {
      treeHasFocusRef.current = Boolean(
        treeRef.current?.contains(event.target as Node)
      )
    }

    document.addEventListener('focusin', handleDocumentFocus)
    return () => document.removeEventListener('focusin', handleDocumentFocus)
  }, [])

  useLayoutEffect(() => {
    const tree = treeRef.current
    if (!tree) return

    const items = Array.from(tree.querySelectorAll<HTMLElement>('[data-tree-path]'))
    if (items.length === 0) {
      focusRecordRef.current = null
      return
    }

    const record = focusRecordRef.current
    const currentItem = record
      ? items.find((item) => item.dataset.treePath === record.path)
      : undefined
    if (currentItem) {
      setRovingItem(currentItem, false)
      return
    }

    const findByPath = (path: string | null) =>
      path ? items.find((item) => item.dataset.treePath === path) : undefined
    const nextSibling = record?.siblingPaths
      .slice(record.siblingIndex + 1)
      .map(findByPath)
      .find(Boolean)
    const previousSibling = record?.siblingPaths
      .slice(0, record.siblingIndex)
      .reverse()
      .map(findByPath)
      .find(Boolean)
    const target = nextSibling ??
      previousSibling ??
      findByPath(record?.parentPath ?? null) ??
      items[0]

    setRovingItem(target, false)
    if (record && treeHasFocusRef.current) {
      target.focus()
    }
  }, [forceExpanded, nodes, setRovingItem])

  return (
    <div
      ref={treeRef}
      className="tree-view"
      role="tree"
      aria-label="Workspace files"
    >
      {nodes.map((node, index) => (
        <TreeNode
          key={node.path}
          node={node}
          onFileClick={onFileClick}
          activeFilePath={activeFilePath}
          depth={0}
          initialTabStop={index === 0}
          parentPath={null}
          onItemFocus={handleItemFocus}
          forceExpanded={forceExpanded}
          expansionByPath={expansionByPath}
          onExpansionChange={handleExpansionChange}
        />
      ))}
    </div>
  )
}
