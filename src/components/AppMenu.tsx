import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  ChevronRight,
  FileText,
  FilePlus,
  FolderClock,
  FolderOpen,
  FolderPlus,
  Keyboard,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Presentation,
  RotateCcw,
  Save,
  SaveAll,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { useStore } from '../store/useStore'
import { pathBasename } from '../lib/path'
import { executeMenuCommand } from '../hooks/useMenuHandler'

const isMacOS = /Mac/i.test(navigator.platform)

function primaryShortcut(
  key: string,
  options: { alt?: boolean; shift?: boolean } = {}
) {
  if (isMacOS) {
    return `⌘${options.alt ? '⌥' : ''}${options.shift ? '⇧' : ''}${key}`
  }

  return `Ctrl+${options.alt ? 'Alt+' : ''}${options.shift ? 'Shift+' : ''}${key}`
}

interface MenuItemProps {
  command: string
  icon: React.ReactNode
  label: string
  shortcut?: string
  disabled?: boolean
  tone?: 'default' | 'danger'
}

function MenuItem({
  command,
  icon,
  label,
  shortcut,
  disabled = false,
  tone = 'default',
}: MenuItemProps) {
  return (
    <DropdownMenu.Item
      className={`chrome-menu-item${tone === 'danger' ? ' chrome-menu-item-danger' : ''}`}
      disabled={disabled}
      onSelect={() => void executeMenuCommand({ command })}
    >
      {icon}
      <span className="chrome-menu-item-label">{label}</span>
      {shortcut && <span className="chrome-menu-shortcut">{shortcut}</span>}
    </DropdownMenu.Item>
  )
}

export function AppMenu() {
  const recentDirectories = useStore(
    (state) => state.preferences.recentDirectories
  )
  const activeFile = useStore((state) => state.activeFile)
  const sidebarVisible = useStore((state) => state.sidebarVisible)
  const hasActiveDocument = activeFile !== null
  const hasActiveCanvas = activeFile?.kind === 'excalidraw'

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className="chrome-icon-button app-menu-trigger"
          aria-label="Open application menu"
          title="Application menu"
        >
          <Menu aria-hidden="true" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="chrome-menu"
          align="start"
          sideOffset={6}
          collisionPadding={8}
        >
          <DropdownMenu.Label className="chrome-menu-label">
            Create
          </DropdownMenu.Label>
          <DropdownMenu.Group>
            <MenuItem
              command="new_file"
              icon={<FilePlus aria-hidden="true" />}
              label="New drawing"
              shortcut={primaryShortcut('N')}
            />
            <MenuItem
              command="new_note"
              icon={<FileText aria-hidden="true" />}
              label="New note"
              shortcut={primaryShortcut('N', { alt: true })}
            />
          </DropdownMenu.Group>

          <DropdownMenu.Separator className="chrome-menu-separator" />
          <DropdownMenu.Label className="chrome-menu-label">
            Workspace
          </DropdownMenu.Label>
          <DropdownMenu.Group>
            <MenuItem
              command="open_directory"
              icon={<FolderOpen aria-hidden="true" />}
              label="Open folder"
              shortcut={primaryShortcut('O')}
            />
            <MenuItem
              command="new_folder"
              icon={<FolderPlus aria-hidden="true" />}
              label="New folder"
              shortcut={primaryShortcut('N', { shift: true })}
            />
          </DropdownMenu.Group>

          {recentDirectories.length > 0 && (
            <DropdownMenu.Sub>
              <DropdownMenu.SubTrigger className="chrome-menu-item">
                <FolderClock aria-hidden="true" />
                <span className="chrome-menu-item-label">Open recent</span>
                <ChevronRight className="chrome-menu-chevron" aria-hidden="true" />
              </DropdownMenu.SubTrigger>
              <DropdownMenu.Portal>
                <DropdownMenu.SubContent
                  className="chrome-menu chrome-submenu"
                  sideOffset={6}
                  collisionPadding={8}
                >
                  {recentDirectories.slice(0, 10).map((directory, index) => (
                    <DropdownMenu.Item
                      className="chrome-menu-item chrome-menu-recent-item"
                      key={directory}
                      title={directory}
                      onSelect={() => void executeMenuCommand({
                        command: `recent_dir_${index}`,
                        data: { directory },
                      })}
                    >
                      <FolderOpen aria-hidden="true" />
                      <span className="chrome-menu-item-copy">
                        <span className="chrome-menu-item-label">
                          {pathBasename(directory)}
                        </span>
                        <span className="chrome-menu-item-detail">
                          {directory}
                        </span>
                      </span>
                    </DropdownMenu.Item>
                  ))}
                  <DropdownMenu.Separator className="chrome-menu-separator" />
                  <DropdownMenu.Item
                    className="chrome-menu-item"
                    onSelect={() => void executeMenuCommand({
                      command: 'clear_recent',
                    })}
                  >
                    <Trash2 aria-hidden="true" />
                    <span className="chrome-menu-item-label">
                      Clear recent folders
                    </span>
                  </DropdownMenu.Item>
                </DropdownMenu.SubContent>
              </DropdownMenu.Portal>
            </DropdownMenu.Sub>
          )}

          <DropdownMenu.Separator className="chrome-menu-separator" />
          <DropdownMenu.Label className="chrome-menu-label">
            Document
          </DropdownMenu.Label>
          <DropdownMenu.Group>
            <MenuItem
              command="save"
              disabled={!hasActiveDocument}
              icon={<Save aria-hidden="true" />}
              label="Save"
              shortcut={primaryShortcut('S')}
            />
            <MenuItem
              command="save_as"
              disabled={!hasActiveDocument}
              icon={<SaveAll aria-hidden="true" />}
              label="Save As…"
              shortcut={primaryShortcut('S', { shift: true })}
            />
          </DropdownMenu.Group>

          <DropdownMenu.Separator className="chrome-menu-separator" />
          <DropdownMenu.Label className="chrome-menu-label">
            View
          </DropdownMenu.Label>
          <MenuItem
            command="toggle_sidebar"
            icon={sidebarVisible
              ? <PanelLeftClose aria-hidden="true" />
              : <PanelLeftOpen aria-hidden="true" />}
            label={sidebarVisible ? 'Hide sidebar' : 'Show sidebar'}
            shortcut={primaryShortcut('B')}
          />
          <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger
              className="chrome-menu-item"
              disabled={!hasActiveCanvas}
            >
              <ZoomIn aria-hidden="true" />
              <span className="chrome-menu-item-label">Canvas view</span>
              <ChevronRight className="chrome-menu-chevron" aria-hidden="true" />
            </DropdownMenu.SubTrigger>
            <DropdownMenu.Portal>
              <DropdownMenu.SubContent
                className="chrome-menu chrome-submenu"
                sideOffset={6}
                collisionPadding={8}
              >
                <MenuItem
                  command="zoom_in"
                  icon={<ZoomIn aria-hidden="true" />}
                  label="Zoom in"
                  shortcut={primaryShortcut('+')}
                />
                <MenuItem
                  command="zoom_out"
                  icon={<ZoomOut aria-hidden="true" />}
                  label="Zoom out"
                  shortcut={primaryShortcut('-')}
                />
                <MenuItem
                  command="reset_zoom"
                  icon={<RotateCcw aria-hidden="true" />}
                  label="Reset view"
                  shortcut={primaryShortcut('0')}
                />
              </DropdownMenu.SubContent>
            </DropdownMenu.Portal>
          </DropdownMenu.Sub>
          <MenuItem
            command="fullscreen"
            icon={<Presentation aria-hidden="true" />}
            label="Full screen"
            shortcut="F11"
          />
          <MenuItem
            command="keyboard_shortcuts"
            icon={<Keyboard aria-hidden="true" />}
            label="Keyboard shortcuts"
          />

          <DropdownMenu.Separator className="chrome-menu-separator" />
          <MenuItem
            command="quit"
            icon={<LogOut aria-hidden="true" />}
            label="Quit Rachana"
            shortcut={primaryShortcut('Q')}
            tone="danger"
          />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
