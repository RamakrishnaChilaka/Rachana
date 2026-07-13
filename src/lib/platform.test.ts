import { describe, expect, it } from 'vitest'
import baseConfig from '../../src-tauri/tauri.conf.json'
import windowsConfig from '../../src-tauri/tauri.windows.conf.json'
import { detectDesktopPlatform } from './platform'

describe('detectDesktopPlatform', () => {
  it.each([
    ['Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15', 'linux'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5)', 'macos'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'desktop'],
  ] as const)('maps %s to %s', (userAgent, expected) => {
    expect(detectDesktopPlatform(userAgent)).toBe(expected)
  })
})

describe('Windows webview configuration', () => {
  it('enables WebView2 pinch zoom for Excalidraw canvas gestures', () => {
    expect(windowsConfig.app.windows).toHaveLength(1)
    const { zoomHotkeysEnabled, ...windowsWindow } = windowsConfig.app.windows[0]

    expect(zoomHotkeysEnabled).toBe(true)
    expect(windowsWindow).toEqual(baseConfig.app.windows[0])
  })
})
