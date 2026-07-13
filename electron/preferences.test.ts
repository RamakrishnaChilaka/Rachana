// @vitest-environment node

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PreferencesStore } from './preferences'

const temporaryDirectories: string[] = []

async function createStore(): Promise<PreferencesStore> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rachana-preferences-'))
  temporaryDirectories.push(directory)
  return new PreferencesStore(directory)
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true })
  ))
})

describe('PreferencesStore', () => {
  it('returns bounded defaults when no preferences exist', async () => {
    const store = await createStore()
    await expect(store.get()).resolves.toMatchObject({
      lastDirectory: null,
      recentDirectories: [],
      theme: 'system',
      sidebarWidth: 248,
    })
  })

  it('round-trips normalized preferences atomically', async () => {
    const store = await createStore()
    await store.save({
      lastDirectory: '/drawings',
      recentDirectories: ['/drawings'],
      theme: 'dark',
      sidebarVisible: false,
      sidebarWidth: 999,
      showDecorations: false,
    })

    await expect(store.get()).resolves.toEqual({
      lastDirectory: '/drawings',
      recentDirectories: ['/drawings'],
      theme: 'dark',
      sidebarVisible: false,
      sidebarWidth: 360,
      showDecorations: false,
    })
  })
})