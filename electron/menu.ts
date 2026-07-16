import { app, Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import type { MenuCommand } from '../src/lib/native'
import type { Preferences } from '../src/types'
import { IPC } from './channels'

let applicationMenuVisible = true

function sendCommand(window: BrowserWindow, command: MenuCommand): void {
  if (!window.isDestroyed()) {
    window.webContents.send(IPC.eventMenuCommand, command)
  }
}

function recentDirectoriesMenu(
  window: BrowserWindow,
  preferences: Preferences
): MenuItemConstructorOptions {
  const recentItems: MenuItemConstructorOptions[] = preferences.recentDirectories
    .slice(0, 10)
    .map((directory, index) => ({
      label: directory.length > 50 ? `...${directory.slice(-47)}` : directory,
      click: () => sendCommand(window, {
        command: `recent_dir_${index}`,
        data: { directory },
      }),
    }))
  if (recentItems.length > 0) {
    recentItems.push(
      { type: 'separator' },
      {
        label: 'Clear Recent',
        click: () => sendCommand(window, { command: 'clear_recent' }),
      }
    )
  }
  return {
    label: 'Recent Directories',
    submenu: recentItems,
  }
}

export function buildApplicationMenu(
  window: BrowserWindow,
  preferences: Preferences
): Menu {
  const template: MenuItemConstructorOptions[] = []
  if (process.platform === 'darwin') {
    template.push({ role: 'appMenu' })
  }
  template.push(
    {
      label: 'File',
      submenu: [
        { label: 'Open Directory', accelerator: 'CmdOrCtrl+O', click: () => sendCommand(window, { command: 'open_directory' }) },
        { label: 'New File', accelerator: 'CmdOrCtrl+N', click: () => sendCommand(window, { command: 'new_file' }) },
        { label: 'New Note', accelerator: 'CmdOrCtrl+Alt+N', click: () => sendCommand(window, { command: 'new_note' }) },
        { label: 'New Folder', accelerator: 'CmdOrCtrl+Shift+N', click: () => sendCommand(window, { command: 'new_folder' }) },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => sendCommand(window, { command: 'save' }) },
        { label: 'Save As...', accelerator: 'CmdOrCtrl+Shift+S', click: () => sendCommand(window, { command: 'save_as' }) },
        { type: 'separator' },
        recentDirectoriesMenu(window, preferences),
        { type: 'separator' },
        { label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: () => sendCommand(window, { command: 'quit' }) },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { type: 'separator' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+B', click: () => sendCommand(window, { command: 'toggle_sidebar' }) },
        { type: 'separator' },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', click: () => sendCommand(window, { command: 'zoom_in' }) },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => sendCommand(window, { command: 'zoom_out' }) },
        { label: 'Reset Zoom', accelerator: 'CmdOrCtrl+0', click: () => sendCommand(window, { command: 'reset_zoom' }) },
        { type: 'separator' },
        { label: 'Toggle Fullscreen', accelerator: process.platform === 'darwin' ? 'Ctrl+Cmd+F' : 'F11', click: () => sendCommand(window, { command: 'fullscreen' }) },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { label: 'Minimize', accelerator: 'CmdOrCtrl+M', click: () => sendCommand(window, { command: 'minimize' }) },
        { label: 'Close Window', accelerator: 'CmdOrCtrl+W', click: () => sendCommand(window, { command: 'close_window' }) },
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Keyboard Shortcuts', click: () => sendCommand(window, { command: 'keyboard_shortcuts' }) },
        { type: 'separator' },
        { label: `About Rachana ${app.getVersion()}`, enabled: false },
      ],
    }
  )
  return Menu.buildFromTemplate(template)
}

export function setApplicationMenu(
  window: BrowserWindow,
  preferences: Preferences,
  visible = applicationMenuVisible
): void {
  applicationMenuVisible = visible
  Menu.setApplicationMenu(
    process.platform === 'darwin' && visible
      ? buildApplicationMenu(window, preferences)
      : null
  )
}