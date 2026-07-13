import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

test('launches Chromium with the preload bridge and saves a drawing', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rachana-smoke-'))
  const workspace = path.join(root, 'workspace')
  const userData = path.join(root, 'user-data')
  await fs.mkdir(workspace, { recursive: true })
  const drawingPath = path.join(workspace, 'Smoke.excalidraw')
  await fs.writeFile(drawingPath, JSON.stringify({
    type: 'excalidraw',
    version: 2,
    source: 'smoke-test',
    elements: [],
    appState: { viewBackgroundColor: '#ffffff' },
    files: {},
  }), 'utf8')

  const executablePath = process.env.RACHANA_ELECTRON_EXECUTABLE
  const application = await electron.launch({
    executablePath,
    args: executablePath ? [] : ['.'],
    env: {
      ...process.env,
      RACHANA_E2E: '1',
      RACHANA_TEST_DIRECTORY: workspace,
      RACHANA_TEST_USER_DATA: userData,
    },
  })

  try {
    const page = await application.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    expect(await page.evaluate(() => navigator.userAgent)).toContain('Electron')
    expect(await page.evaluate(() => Boolean(
      (window as Window & { rachana?: unknown }).rachana
    ))).toBe(true)
    expect(await page.evaluate(async () => {
      const response = await fetch(
        './assets/excalidraw/fonts/Virgil/Virgil-Regular.woff2'
      )
      return response.ok && (await response.arrayBuffer()).byteLength > 0
    })).toBe(true)

    await page.locator('.empty-primary-action').click()
    await expect(page.getByRole('treeitem', { name: /Smoke/ })).toBeVisible()
    await page.getByRole('treeitem', { name: /Smoke/ }).click()
    await expect(page.getByText('Loading canvas...')).toBeHidden({ timeout: 15_000 })

    await page.locator('[data-testid="toolbar-rectangle"]').click({ force: true })
    const canvas = page.locator('canvas.interactive').filter({ visible: true }).first()
    const bounds = await canvas.boundingBox()
    expect(bounds).not.toBeNull()
    await page.mouse.move(bounds!.x + 250, bounds!.y + 220)
    await page.mouse.down()
    await page.mouse.move(bounds!.x + 430, bounds!.y + 340, { steps: 10 })
    await page.mouse.up()
    await expect(page.getByRole('status', { name: 'Document save status' }))
      .toHaveText('Unsaved changes')

    await page.keyboard.press('Control+s')
    await expect(page.getByRole('status', { name: 'Document save status' }))
      .toHaveText('Saved')
    const saved = JSON.parse(await fs.readFile(drawingPath, 'utf8'))
    expect(saved.elements.filter((element: { isDeleted?: boolean }) => !element.isDeleted))
      .toHaveLength(1)
  } finally {
    await application.close()
    await fs.rm(root, { recursive: true, force: true })
  }
})