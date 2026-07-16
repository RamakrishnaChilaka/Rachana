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
  const markdownPath = path.join(workspace, 'Notes.md')
  await fs.writeFile(drawingPath, JSON.stringify({
    type: 'excalidraw',
    version: 2,
    source: 'smoke-test',
    elements: [],
    appState: { viewBackgroundColor: '#ffffff' },
    files: {},
  }), 'utf8')
  await fs.writeFile(markdownPath, '# Existing note\n', 'utf8')

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

    const newDocumentTrigger = page.locator('.tab-region').getByRole(
      'button',
      { name: 'New document' }
    )
    await expect(page.locator('.sidebar-actions').getByRole(
      'button',
      { name: 'New document' }
    )).toBeVisible()
    await newDocumentTrigger.click()
    const newDocumentMenu = page.getByRole('menu', { name: 'New document' })
    await expect(newDocumentMenu.getByRole('menuitem', {
      name: 'New drawing',
    })).toBeVisible()
    await expect(newDocumentMenu.getByRole('menuitem', {
      name: 'New note',
    })).toBeVisible()
    await page.keyboard.press('Escape')

    const appMenuTrigger = page.getByRole('button', {
      name: 'Open application menu',
    })
    await appMenuTrigger.click()
    const appMenu = page.getByRole('menu', { name: 'Open application menu' })
    await expect(appMenu).toBeVisible()
    await expect(appMenu.getByRole('menuitem', { name: /^Save (?:Ctrl|⌘)/ }))
      .toHaveAttribute('data-disabled', '')
    await expect(appMenu.getByRole('menuitem', { name: /Canvas view/ }))
      .toHaveAttribute('data-disabled', '')
    await page.keyboard.press('Escape')

    await page.locator('.empty-primary-action').click()
    await expect(page.getByRole('treeitem', { name: /Smoke/ })).toBeVisible()
    await page.getByRole('treeitem', { name: /Smoke/ }).click()
    await expect(page.getByText('Loading canvas...')).toBeHidden({ timeout: 15_000 })
    const fontStatus = await page.evaluate(async () => {
      const faces = Array.from(document.fonts).filter(
        (face) => face.family === 'Excalifont'
      )
      const assetPath = (
        window as Window & { EXCALIDRAW_ASSET_PATH?: string }
      ).EXCALIDRAW_ASSET_PATH
      const latinUrl = new URL(
        './fonts/Excalifont/Excalifont-Regular-a88b72a24fb54c9f94e3b5fdaa7481c9.woff2',
        assetPath
      ).href
      let fontBytes = 0
      try {
        const response = await fetch(latinUrl)
        fontBytes = response.ok ? (await response.arrayBuffer()).byteLength : 0
      } catch {}
      const loads = await Promise.allSettled(faces.map((face) => face.load()))
      return {
        assetPath,
        fontBytes,
        faceCount: faces.length,
        loaded: loads.every(
          (result) => result.status === 'fulfilled' && result.value.status === 'loaded'
        ),
      }
    })
    expect(fontStatus.assetPath).toMatch(/\/assets\/excalidraw\/$/)
    expect(fontStatus.fontBytes).toBeGreaterThan(0)
    expect(fontStatus.faceCount).toBeGreaterThan(0)
    expect(fontStatus.loaded).toBe(true)

    await page.locator('[data-testid="toolbar-text"]').click({ force: true })
    const canvas = page.locator('canvas.interactive').filter({ visible: true }).first()
    const bounds = await canvas.boundingBox()
    expect(bounds).not.toBeNull()
    await page.mouse.click(bounds!.x + 300, bounds!.y + 250)
    const textEditor = page.locator('textarea.excalidraw-wysiwyg')
    await expect(textEditor).toBeVisible()
    await textEditor.fill('Hand drawn')
    await textEditor.press('Control+Enter')
    await expect(page.getByRole('status', { name: 'Document save status' }))
      .toHaveText('Unsaved changes')

    await page.keyboard.press('Control+s')
    await expect(page.getByRole('status', { name: 'Document save status' }))
      .toHaveText('Saved')
    await appMenuTrigger.click()
    await expect(appMenu.getByRole('menuitem', { name: /Canvas view/ }))
      .not.toHaveAttribute('data-disabled')
    await page.keyboard.press('Escape')

    const saved = JSON.parse(await fs.readFile(drawingPath, 'utf8'))
    const visibleElements = saved.elements.filter(
      (element: { isDeleted?: boolean }) => !element.isDeleted
    )
    expect(visibleElements).toHaveLength(1)
    expect(visibleElements[0]).toMatchObject({
      type: 'text',
      text: 'Hand drawn',
      fontFamily: 5,
    })

    await page.getByRole('treeitem', { name: /^Notes/ }).click()
    const markdownSource = page.locator('.markdown-source .cm-content')
    await expect(markdownSource).toBeVisible()
    await markdownSource.click()
    await page.keyboard.press('Control+a')
    await page.keyboard.insertText('# Markdown note\n\n- [x] saved locally')
    await expect(page.getByRole('heading', { name: 'Markdown note' })).toBeVisible()
    await expect(page.getByRole('checkbox')).toBeChecked()
    await expect(page.getByRole('status', { name: 'Document save status' }))
      .toHaveText('Unsaved changes')

    await page.keyboard.press('Control+s')
    await expect(page.getByRole('status', { name: 'Document save status' }))
      .toHaveText('Saved')
    await expect(fs.readFile(markdownPath, 'utf8')).resolves.toBe(
      '# Markdown note\n\n- [x] saved locally'
    )

    await page.setViewportSize({ width: 760, height: 520 })
    await appMenuTrigger.click()
    await expect(appMenu).toBeVisible()
    await expect(appMenu.getByText('Create', { exact: true })).toBeVisible()
    await expect(appMenu.getByRole('menuitem', { name: /New note/ })).toBeVisible()
    await expect(appMenu.getByRole('menuitem', { name: /^Save (?:Ctrl|⌘)/ }))
      .not.toHaveAttribute('data-disabled')
    await expect(appMenu.getByRole('menuitem', { name: /Canvas view/ }))
      .toHaveAttribute('data-disabled', '')

    await appMenu.evaluate(async (element) => {
      await Promise.all(
        element.getAnimations().map((animation) => animation.finished)
      )
    })
    const menuLayout = await appMenu.evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      return {
        bottom: bounds.bottom,
        height: window.innerHeight,
        overflowY: getComputedStyle(element).overflowY,
        top: bounds.top,
      }
    })
    expect(menuLayout.top).toBeGreaterThanOrEqual(0)
    expect(menuLayout.bottom).toBeLessThanOrEqual(menuLayout.height)
    expect(menuLayout.overflowY).toBe('auto')
  } finally {
    await application.close()
    await fs.rm(root, { recursive: true, force: true })
  }
})