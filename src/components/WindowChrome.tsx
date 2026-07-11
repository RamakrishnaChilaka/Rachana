import { useEffect, useState, type PointerEvent } from 'react'
import {
  Copy,
  Minus,
  PanelLeftClose,
  PanelLeftOpen,
  Square,
  X,
} from 'lucide-react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useStore } from '../store/useStore'
import { AppMenu } from './AppMenu'
import { TabBar } from './TabBar'

type ResizeDirection =
  | 'East'
  | 'North'
  | 'NorthEast'
  | 'NorthWest'
  | 'South'
  | 'SouthEast'
  | 'SouthWest'
  | 'West'

const isMacOS = /Macintosh|Mac OS X/i.test(navigator.userAgent)

interface SidebarToggleProps {
  visible: boolean
}

function SidebarToggle({ visible }: SidebarToggleProps) {
  const toggleSidebar = useStore((state) => state.toggleSidebar)
  const label = visible ? 'Hide sidebar' : 'Show sidebar'

  return (
    <button
      className="chrome-icon-button"
      aria-label={label}
      title={`${label} (Ctrl+B)`}
      onClick={toggleSidebar}
    >
      {visible
        ? <PanelLeftClose aria-hidden="true" />
        : <PanelLeftOpen aria-hidden="true" />}
    </button>
  )
}

export function SidebarChrome() {
  return (
    <div className="sidebar-window-rail">
      <div className="macos-traffic-light-space" data-tauri-drag-region />
      <AppMenu />
      <SidebarToggle visible />
      <div className="window-drag-region" data-tauri-drag-region />
    </div>
  )
}

function WindowControls() {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (isMacOS) return

    const appWindow = getCurrentWindow()
    let mounted = true
    const updateMaximized = () => {
      void appWindow.isMaximized().then((nextMaximized) => {
        if (mounted) setMaximized(nextMaximized)
      })
    }
    const unlisten = appWindow.onResized(updateMaximized)
    updateMaximized()

    return () => {
      mounted = false
      void unlisten.then((cleanup) => cleanup())
    }
  }, [])

  if (isMacOS) return null

  const appWindow = getCurrentWindow()
  const toggleMaximize = async () => {
    await appWindow.toggleMaximize()
    setMaximized(await appWindow.isMaximized())
  }

  return (
    <div className="window-controls" aria-label="Window controls">
      <button
        aria-label="Minimize window"
        title="Minimize"
        onClick={() => void appWindow.minimize()}
      >
        <Minus aria-hidden="true" />
      </button>
      <button
        aria-label={maximized ? 'Restore window' : 'Maximize window'}
        title={maximized ? 'Restore' : 'Maximize'}
        onClick={() => void toggleMaximize()}
      >
        {maximized
          ? <Copy className="restore-window-icon" aria-hidden="true" />
          : <Square aria-hidden="true" />}
      </button>
      <button
        className="window-close"
        aria-label="Close window"
        title="Close"
        onClick={() => void appWindow.close()}
      >
        <X aria-hidden="true" />
      </button>
    </div>
  )
}

export function DocumentChrome() {
  const sidebarVisible = useStore((state) => state.sidebarVisible)

  return (
    <header
      className="document-window-rail"
      role="banner"
      aria-label="Open documents"
    >
      {!sidebarVisible && (
        <div className="document-rail-leading">
          <div className="macos-traffic-light-space" data-tauri-drag-region />
          <AppMenu />
          <SidebarToggle visible={false} />
        </div>
      )}
      <TabBar />
      <WindowControls />
    </header>
  )
}

interface ResizeHandle {
  direction: ResizeDirection
  className: string
}

const resizeHandles: ResizeHandle[] = [
  { direction: 'North', className: 'window-resize-north' },
  { direction: 'East', className: 'window-resize-east' },
  { direction: 'South', className: 'window-resize-south' },
  { direction: 'West', className: 'window-resize-west' },
  { direction: 'NorthEast', className: 'window-resize-north-east' },
  { direction: 'NorthWest', className: 'window-resize-north-west' },
  { direction: 'SouthEast', className: 'window-resize-south-east' },
  { direction: 'SouthWest', className: 'window-resize-south-west' },
]

export function WindowResizeHandles() {
  if (isMacOS) return null

  const startResize = (
    event: PointerEvent<HTMLDivElement>,
    direction: ResizeDirection
  ) => {
    if (event.button !== 0) return
    event.preventDefault()
    void getCurrentWindow().startResizeDragging(direction)
  }

  return (
    <div className="window-resize-handles" aria-hidden="true">
      {resizeHandles.map(({ direction, className }) => (
        <div
          className={`window-resize-handle ${className}`}
          key={direction}
          onPointerDown={(event) => startResize(event, direction)}
        />
      ))}
    </div>
  )
}
