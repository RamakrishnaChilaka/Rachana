import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { Preferences } from '../src/types'

const DEFAULT_PREFERENCES: Preferences = {
  lastDirectory: null,
  recentDirectories: [],
  theme: 'system',
  sidebarVisible: true,
  sidebarWidth: 248,
  showDecorations: true,
}

function normalizePreferences(value: unknown): Preferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_PREFERENCES }
  }
  const candidate = value as Partial<Preferences>
  const sidebarWidth = Number(candidate.sidebarWidth)
  return {
    lastDirectory:
      typeof candidate.lastDirectory === 'string'
        ? candidate.lastDirectory
        : null,
    recentDirectories: Array.isArray(candidate.recentDirectories)
      ? candidate.recentDirectories.filter(
        (directory): directory is string => typeof directory === 'string'
      ).slice(0, 10)
      : [],
    theme:
      candidate.theme === 'light' ||
      candidate.theme === 'dark' ||
      candidate.theme === 'system'
        ? candidate.theme
        : 'system',
    sidebarVisible:
      typeof candidate.sidebarVisible === 'boolean'
        ? candidate.sidebarVisible
        : true,
    sidebarWidth: Number.isFinite(sidebarWidth)
      ? Math.min(360, Math.max(200, Math.round(sidebarWidth)))
      : 248,
    showDecorations:
      typeof candidate.showDecorations === 'boolean'
        ? candidate.showDecorations
        : true,
  }
}

export class PreferencesStore {
  readonly filePath: string

  constructor(userDataDirectory: string) {
    this.filePath = path.join(userDataDirectory, 'preferences.json')
  }

  async get(): Promise<Preferences> {
    try {
      return normalizePreferences(
        JSON.parse(await fs.readFile(this.filePath, 'utf8'))
      )
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== 'ENOENT' &&
        !(error instanceof SyntaxError)
      ) {
        throw error
      }
      return { ...DEFAULT_PREFERENCES }
    }
  }

  async save(preferences: Preferences): Promise<void> {
    const normalized = normalizePreferences(preferences)
    await fs.mkdir(path.dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`
    const handle = await fs.open(temporaryPath, 'wx', 0o600)
    try {
      await handle.writeFile(JSON.stringify(normalized, null, 2), 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    try {
      await fs.rename(temporaryPath, this.filePath)
    } finally {
      await fs.unlink(temporaryPath).catch(() => undefined)
    }
  }
}