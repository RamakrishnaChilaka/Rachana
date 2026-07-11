export type DesktopPlatform = 'macos' | 'linux' | 'desktop'

export function detectDesktopPlatform(userAgent: string): DesktopPlatform {
  if (/Macintosh|Mac OS X/i.test(userAgent)) {
    return 'macos'
  }

  return /Linux/i.test(userAgent) ? 'linux' : 'desktop'
}
