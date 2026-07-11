import '@testing-library/jest-dom'
import { vi, beforeEach } from 'vitest'

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal('ResizeObserver', TestResizeObserver)

// Mock Tauri API for tests
const mockInvoke = vi.fn()
const mockListen = vi.fn()
const mockAppWindow = {
  close: vi.fn(() => Promise.resolve()),
  minimize: vi.fn(() => Promise.resolve()),
  maximize: vi.fn(() => Promise.resolve()),
  toggleMaximize: vi.fn(() => Promise.resolve()),
  isMaximized: vi.fn(() => Promise.resolve(false)),
  isFullscreen: vi.fn(() => Promise.resolve(false)),
  setFullscreen: vi.fn(() => Promise.resolve()),
  startResizeDragging: vi.fn(() => Promise.resolve()),
  onResized: vi.fn(() => Promise.resolve(vi.fn())),
}
const saveResult = (contentHash: string, fileIdentity = `identity:${contentHash}`) => ({
  content_hash: contentHash,
  file_identity: fileIdentity,
})

// Mock @tauri-apps/api/core
vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}))

// Mock @tauri-apps/api/event
vi.mock('@tauri-apps/api/event', () => ({
  listen: mockListen,
  emit: vi.fn(),
}))

// Mock @tauri-apps/api/window
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => mockAppWindow,
}))

// Mock @tauri-apps/plugin-dialog
vi.mock('@tauri-apps/plugin-dialog', () => ({
  ask: vi.fn(),
  message: vi.fn(),
}))

// Mock @tauri-apps/plugin-opener
vi.mock('@tauri-apps/plugin-opener', () => ({}))

// Reset mocks before each test
beforeEach(() => {
  mockInvoke.mockReset()
  mockListen.mockReset()
  for (const method of Object.values(mockAppWindow)) {
    method.mockClear()
  }
})

// Export mocks for use in tests
export { mockAppWindow, mockInvoke, mockListen, saveResult }