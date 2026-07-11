import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import { ScrollArea } from '@radix-ui/react-scroll-area'
import * as Tooltip from '@radix-ui/react-tooltip'
import { FolderOpen, FolderPlus, Plus, Search, X } from 'lucide-react'
import { useStore } from '../store/useStore'
import { TreeView } from './TreeView'
import {
  clampSidebarWidth,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
} from '../lib/layout'
import { pathBasename } from '../lib/path'
import { filterFileTree } from '../lib/fileTreeFilter'
import {
  createDrawing,
  createWorkspaceFolder,
  selectWorkspace,
} from '../lib/workspaceActions'
import { SidebarChrome } from './WindowChrome'

interface IconActionProps {
  label: string
  onClick: () => void
  children: React.ReactNode
}

function IconAction({ label, onClick, children }: IconActionProps) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button className="sidebar-icon-action" onClick={onClick} aria-label={label}>
          {children}
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="app-tooltip" side="bottom" sideOffset={6}>
          {label}
          <Tooltip.Arrow className="app-tooltip-arrow" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

export function Sidebar() {
  const currentDirectory = useStore((state) => state.currentDirectory)
  const fileTree = useStore((state) => state.fileTree)
  const activeFile = useStore((state) => state.activeFile)
  const loadFileFromTree = useStore((state) => state.loadFileFromTree)
  const preferredWidth = useStore((state) => state.preferences.sidebarWidth)
  const persistSidebarWidth = useStore((state) => state.setSidebarWidth)
  const [width, setWidth] = useState(preferredWidth)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const latestWidthRef = useRef(width)
  const resizeCleanupRef = useRef<(() => void) | null>(null)
  const searchButtonRef = useRef<HTMLButtonElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const treeRegionRef = useRef<HTMLDivElement>(null)
  const treeHadFocusRef = useRef(false)
  const filteredTree = useMemo(
    () => filterFileTree(fileTree, searchQuery),
    [fileTree, searchQuery]
  )
  const isFiltering = searchQuery.trim().length > 0

  useEffect(() => {
    setWidth(preferredWidth)
    latestWidthRef.current = preferredWidth
  }, [preferredWidth])

  useEffect(() => () => resizeCleanupRef.current?.(), [])

  useEffect(() => {
    if (searchOpen) {
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    }
  }, [searchOpen])

  useEffect(() => {
    setSearchQuery('')
    setSearchOpen(false)
  }, [currentDirectory])

  useLayoutEffect(() => {
    if (
      searchOpen &&
      isFiltering &&
      filteredTree.nodes.length === 0 &&
      treeHadFocusRef.current
    ) {
      const activeElement = document.activeElement
      const focusWasLostWithTree =
        !activeElement ||
        activeElement === document.body ||
        !activeElement.isConnected ||
        treeRegionRef.current?.contains(activeElement)
      treeHadFocusRef.current = false
      if (!focusWasLostWithTree) {
        return
      }
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    }
  }, [filteredTree.nodes.length, isFiltering, searchOpen])

  const closeSearch = () => {
    setSearchQuery('')
    setSearchOpen(false)
    searchButtonRef.current?.focus()
  }

  const clearSearch = () => {
    setSearchQuery('')
    searchInputRef.current?.focus()
  }

  const updateWidth = (nextWidth: number) => {
    const clampedWidth = clampSidebarWidth(nextWidth)
    latestWidthRef.current = clampedWidth
    setWidth(clampedWidth)
  }

  const handleResizePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    resizeCleanupRef.current?.()

    const resizeHandle = event.currentTarget
    const pointerId = event.pointerId
    const startX = event.clientX
    const startWidth = latestWidthRef.current
    let finished = false

    resizeHandle.setPointerCapture(pointerId)

    const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
      if (moveEvent.buttons === 0) {
        finishResize()
        return
      }
      updateWidth(startWidth + moveEvent.clientX - startX)
    }
    const finishResize = () => {
      if (finished) return
      finished = true

      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', finishResize)
      window.removeEventListener('pointercancel', finishResize)
      window.removeEventListener('blur', finishResize)
      resizeHandle.removeEventListener('lostpointercapture', finishResize)
      if (resizeHandle.hasPointerCapture(pointerId)) {
        resizeHandle.releasePointerCapture(pointerId)
      }
      resizeCleanupRef.current = null
      persistSidebarWidth(latestWidthRef.current)
    }

    resizeCleanupRef.current = finishResize
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', finishResize)
    window.addEventListener('pointercancel', finishResize)
    window.addEventListener('blur', finishResize)
    resizeHandle.addEventListener('lostpointercapture', finishResize)
  }

  const handleResizeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 24 : 8
    let nextWidth: number | null = null

    if (event.key === 'ArrowLeft') nextWidth = width - step
    if (event.key === 'ArrowRight') nextWidth = width + step
    if (event.key === 'Home') nextWidth = MIN_SIDEBAR_WIDTH
    if (event.key === 'End') nextWidth = MAX_SIDEBAR_WIDTH

    if (nextWidth === null) {
      return
    }

    event.preventDefault()
    updateWidth(nextWidth)
    persistSidebarWidth(nextWidth)
  }

  const workspaceName = currentDirectory ? pathBasename(currentDirectory) : 'No folder open'

  return (
    <Tooltip.Provider delayDuration={450}>
      <aside
        className="sidebar-panel"
        aria-label="Workspace explorer"
        style={{ width: `${width}px`, flexBasis: `${width}px` }}
      >
        <SidebarChrome />
        <header className="sidebar-header">
          <div className="workspace-heading">
            <div className="workspace-title-row" title={currentDirectory || 'Open a local folder'}>
              <FolderOpen aria-hidden="true" />
              <span className="workspace-title">{workspaceName}</span>
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <button
                    ref={searchButtonRef}
                    className="sidebar-search-toggle"
                    aria-label="Search workspace files"
                    aria-controls="workspace-file-filter"
                    aria-expanded={searchOpen}
                    onClick={() => {
                      if (searchOpen) {
                        closeSearch()
                      } else {
                        setSearchOpen(true)
                      }
                    }}
                  >
                    <Search aria-hidden="true" />
                  </button>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content className="app-tooltip" side="bottom" sideOffset={6}>
                    Search files
                    <Tooltip.Arrow className="app-tooltip-arrow" />
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>
            </div>
          </div>

          <div className="sidebar-actions" aria-label="Workspace actions">
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <button
                  className="sidebar-primary-action"
                  onClick={() => void createDrawing()}
                  aria-label="New drawing"
                >
                  <Plus aria-hidden="true" />
                  <span className="sidebar-primary-action-label">New drawing</span>
                </button>
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content className="app-tooltip" side="bottom" sideOffset={6}>
                  New drawing
                  <Tooltip.Arrow className="app-tooltip-arrow" />
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
            <IconAction label="Open folder" onClick={() => void selectWorkspace()}>
              <FolderOpen aria-hidden="true" />
            </IconAction>
            <IconAction label="New folder" onClick={() => void createWorkspaceFolder()}>
              <FolderPlus aria-hidden="true" />
            </IconAction>
          </div>

          {searchOpen && (
            <div className="sidebar-search-field" id="workspace-file-filter">
              <Search aria-hidden="true" />
              <input
                ref={searchInputRef}
                value={searchQuery}
                aria-label="Filter workspace files"
                placeholder="Filter files and folders"
                onFocus={() => {
                  treeHadFocusRef.current = false
                }}
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Escape') return

                  event.preventDefault()
                  if (searchQuery) {
                    clearSearch()
                  } else {
                    closeSearch()
                  }
                }}
              />
              {searchQuery && (
                <button
                  className="sidebar-search-clear"
                  aria-label="Clear file filter"
                  onClick={clearSearch}
                >
                  <X aria-hidden="true" />
                </button>
              )}
            </div>
          )}
          <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
            {isFiltering
              ? `${filteredTree.matchCount} ${filteredTree.matchCount === 1 ? 'result' : 'results'}`
              : ''}
          </span>
        </header>

        <ScrollArea className="sidebar-scroll custom-scrollbar">
          <div className="sidebar-tree">
            {fileTree.length === 0 ? (
              <div className="sidebar-empty">
                <p>{currentDirectory ? 'No drawings yet' : 'Open a folder to browse drawings'}</p>
                {currentDirectory && (
                  <button onClick={() => void createDrawing()}>Create a drawing</button>
                )}
              </div>
            ) : (
              <>
                {isFiltering && filteredTree.nodes.length === 0 && (
                  <div className="sidebar-no-results">
                    <Search aria-hidden="true" />
                    <p>No matching files or folders</p>
                    <button onClick={clearSearch}>Clear filter</button>
                  </div>
                )}
                <div
                  ref={treeRegionRef}
                  hidden={isFiltering && filteredTree.nodes.length === 0}
                  onFocusCapture={() => {
                    treeHadFocusRef.current = true
                  }}
                >
                  <TreeView
                    nodes={filteredTree.nodes}
                    onFileClick={loadFileFromTree}
                    activeFilePath={activeFile?.path}
                    forceExpanded={isFiltering}
                  />
                </div>
              </>
            )}
          </div>
        </ScrollArea>

        <div
          className="sidebar-resize-handle"
          role="separator"
          aria-label="Resize workspace sidebar"
          aria-orientation="vertical"
          aria-valuemin={MIN_SIDEBAR_WIDTH}
          aria-valuemax={MAX_SIDEBAR_WIDTH}
          aria-valuenow={width}
          tabIndex={0}
          onPointerDown={handleResizePointerDown}
          onKeyDown={handleResizeKeyDown}
        />
      </aside>
    </Tooltip.Provider>
  )
}
