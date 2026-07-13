import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, session, shell } from 'electron'
import { IPC } from './channels'
import { registerNativeIpc, stopNativeServices } from './ipc'
import { CloseCoordinator } from './lifecycle'
import { setApplicationMenu } from './menu'
import { PreferencesStore } from './preferences'
import { isTrustedRendererDocument } from './security'

let mainWindow: BrowserWindow | null = null
const closeCoordinator = new CloseCoordinator()
const isDevelopment = !app.isPackaged

if (
  process.env.RACHANA_E2E === '1' &&
  process.env.RACHANA_TEST_USER_DATA
) {
  app.setPath('userData', process.env.RACHANA_TEST_USER_DATA)
}
const rendererEntryUrl = isDevelopment && process.env.ELECTRON_RENDERER_URL
  ? process.env.ELECTRON_RENDERER_URL
  : pathToFileURL(join(__dirname, '../renderer/index.html')).href

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    title: 'Rachana',
    width: 1600,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    show: false,
    center: true,
    frame: process.platform === 'darwin',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    autoHideMenuBar: process.platform !== 'darwin',
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      spellcheck: false,
      nodeIntegrationInWorker: false,
    },
  })

  const showWindow = () => {
    if (!window.isDestroyed()) window.show()
  }
  if (process.platform === 'linux' && process.env.WAYLAND_DISPLAY) {
    window.webContents.once('did-finish-load', showWindow)
  } else {
    window.once('ready-to-show', showWindow)
  }
  window.on('maximize', () => window.webContents.send(IPC.eventMaximizedChange, true))
  window.on('unmaximize', () => window.webContents.send(IPC.eventMaximizedChange, false))
  window.on('close', (event) => {
    if (!closeCoordinator.canClose) {
      event.preventDefault()
      if (closeCoordinator.request()) {
        window.webContents.send(IPC.eventCheckUnsavedBeforeClose)
      }
    }
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedRendererDocument(rendererEntryUrl, url)) {
      event.preventDefault()
    }
  })

  if (isDevelopment) {
    void window.loadURL(rendererEntryUrl)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return window
}

const singleInstance = app.requestSingleInstanceLock()
if (!singleInstance) {
  app.quit()
} else {
  app.whenReady().then(async () => {
    app.setAppUserModelId('io.github.ramakrishnachilaka.rachana')
    session.defaultSession.setPermissionCheckHandler(() => false)
    session.defaultSession.setPermissionRequestHandler(
      (_webContents, _permission, callback) => callback(false)
    )
    mainWindow = createWindow()
    const preferences = new PreferencesStore(app.getPath('userData'))
    registerNativeIpc({
      getWindow: () => mainWindow,
      isTrustedFrameUrl: (url) =>
        isTrustedRendererDocument(rendererEntryUrl, url),
      preferences,
      forceClose: () => {
        closeCoordinator.approve()
        app.quit()
      },
      cancelClose: () => closeCoordinator.cancel(),
    })
    setApplicationMenu(mainWindow, await preferences.get())

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createWindow()
      }
    })
  })

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.on('before-quit', (event) => {
    if (!closeCoordinator.canClose && mainWindow && !mainWindow.isDestroyed()) {
      event.preventDefault()
      mainWindow.close()
    }
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  app.on('will-quit', () => {
    void stopNativeServices()
  })
}