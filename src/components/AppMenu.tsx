import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  ChevronRight,
  FilePlus,
  FolderClock,
  FolderOpen,
  FolderPlus,
  Keyboard,
  LogOut,
  Menu,
  Presentation,
  RotateCcw,
  Save,
  SaveAll,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { useStore } from '../store/useStore'
import { pathBasename } from '../lib/path'
import { executeMenuCommand } from '../hooks/useMenuHandler'

const modifier = /Mac/i.test(navigator.platform) ? '⌘' : 'Ctrl'

interface MenuItemProps {
  command: string
  icon: React.ReactNode
  label: string
  shortcut?: string
}

function MenuItem({ command, icon, label, shortcut }: MenuItemProps) {
  return (
    <DropdownMenu.Item
      className="chrome-menu-item"
      onSelect={() => void executeMenuCommand({ command })}
    >
      {icon}
      <span>{label}</span>
      {shortcut && <span className="chrome-menu-shortcut">{shortcut}</span>}
    </DropdownMenu.Item>
  )
}

export function AppMenu() {
  const recentDirectories = useStore(
    (state) => state.preferences.recentDirectories
  )

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
          <MenuItem
            command="new_file"
            icon={<FilePlus aria-hidden="true" />}
            label="New drawing"
            shortcut={`${modifier}+N`}
          />
          <MenuItem
            command="open_directory"
            icon={<FolderOpen aria-hidden="true" />}
            label="Open folder"
            shortcut={`${modifier}+O`}
          />
          <MenuItem
            command="new_folder"
            icon={<FolderPlus aria-hidden="true" />}
            label="New folder"
            shortcut={`${modifier}+Shift+N`}
          />

          {recentDirectories.length > 0 && (
            <DropdownMenu.Sub>
              <DropdownMenu.SubTrigger className="chrome-menu-item">
                <FolderClock aria-hidden="true" />
                <span>Open recent</span>
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
                      className="chrome-menu-item"
                      key={directory}
                      title={directory}
                      onSelect={() => void executeMenuCommand({
                        command: `recent_dir_${index}`,
                        data: { directory },
                      })}
                    >
                      <FolderOpen aria-hidden="true" />
                      <span className="chrome-menu-path">
                        {pathBasename(directory)}
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
                    <span className="chrome-menu-icon-placeholder" />
                    <span>Clear recent folders</span>
                  </DropdownMenu.Item>
                </DropdownMenu.SubContent>
              </DropdownMenu.Portal>
            </DropdownMenu.Sub>
          )}

          <DropdownMenu.Separator className="chrome-menu-separator" />
          <MenuItem
            command="save"
            icon={<Save aria-hidden="true" />}
            label="Save"
            shortcut={`${modifier}+S`}
          />
          <MenuItem
            command="save_as"
            icon={<SaveAll aria-hidden="true" />}
            label="Save As…"
            shortcut={`${modifier}+Shift+S`}
          />

          <DropdownMenu.Separator className="chrome-menu-separator" />
          <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger className="chrome-menu-item">
              <ZoomIn aria-hidden="true" />
              <span>Canvas view</span>
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
                  shortcut={`${modifier}++`}
                />
                <MenuItem
                  command="zoom_out"
                  icon={<ZoomOut aria-hidden="true" />}
                  label="Zoom out"
                  shortcut={`${modifier}+-`}
                />
                <MenuItem
                  command="reset_zoom"
                  icon={<RotateCcw aria-hidden="true" />}
                  label="Reset view"
                  shortcut={`${modifier}+0`}
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
            label="Quit"
            shortcut={`${modifier}+Q`}
          />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
