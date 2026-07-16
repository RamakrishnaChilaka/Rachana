// @vitest-environment node

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createNewFile,
  getDeletionScopeMatches,
  getFileTree,
  readDocumentFile,
  saveDocumentFile,
  saveDocumentFileAs,
} from './filesystem'

const temporaryDirectories: string[] = []

async function temporaryDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rachana-electron-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true })
  ))
})

describe('Electron filesystem service', () => {
  it('creates, discovers, reads, and saves Markdown as plain text', async () => {
    const directory = await temporaryDirectory()
    const filePath = await createNewFile(directory, 'Notes', 'markdown')
    const opened = await readDocumentFile(filePath)

    expect(filePath).toBe(path.join(directory, 'Notes.md'))
    expect(opened.content).toBe('')
    expect(await getFileTree(directory)).toEqual([
      expect.objectContaining({
        name: 'Notes.md',
        kind: 'markdown',
        is_directory: false,
      }),
    ])

    const content = '# Notes\n\n- one\n- two\n'
    await saveDocumentFile({
      filePath,
      content,
      expectedHash: opened.contentHash,
      expectedIdentity: opened.fileIdentity,
    })
    await expect(fs.readFile(filePath, 'utf8')).resolves.toBe(content)
  })

  it('does not allow Save As to change a document type', async () => {
    const directory = await temporaryDirectory()
    const sourcePath = await createNewFile(directory, 'Notes.md', 'markdown')
    const source = await readDocumentFile(sourcePath)

    await expect(saveDocumentFileAs({
      filePath: path.join(directory, 'Notes.excalidraw'),
      content: source.content,
      openPaths: [],
      sourcePath,
      isRecovery: false,
    })).rejects.toThrow('preserve the document type')
  })

  it('creates and reads a valid drawing with a stable identity', async () => {
    const directory = await temporaryDirectory()
    const filePath = await createNewFile(directory, 'Plan', 'excalidraw')

    const firstRead = await readDocumentFile(filePath)
    const secondRead = await readDocumentFile(filePath)

    expect(filePath).toBe(path.join(directory, 'Plan.excalidraw'))
    expect(JSON.parse(firstRead.content).type).toBe('excalidraw')
    expect(firstRead.contentHash).toBe(secondRead.contentHash)
    expect(firstRead.fileIdentity).toBe(secondRead.fileIdentity)
  })

  it('rejects a stale save without changing disk content', async () => {
    const directory = await temporaryDirectory()
    const filePath = await createNewFile(directory, 'Stale.excalidraw', 'excalidraw')
    const opened = await readDocumentFile(filePath)
    const externalContent = opened.content.replace('#ffffff', '#ff0000')
    await fs.writeFile(filePath, externalContent, 'utf8')

    await expect(saveDocumentFile({
      filePath,
      content: opened.content.replace('#ffffff', '#00ff00'),
      expectedHash: opened.contentHash,
      expectedIdentity: opened.fileIdentity,
    })).rejects.toThrow('changed on disk')
    await expect(fs.readFile(filePath, 'utf8')).resolves.toBe(externalContent)
  })

  it('rejects a same-content replacement by file identity', async () => {
    const directory = await temporaryDirectory()
    const filePath = await createNewFile(directory, 'Replaced.excalidraw', 'excalidraw')
    const opened = await readDocumentFile(filePath)
    await fs.rename(filePath, `${filePath}.original`)
    await fs.writeFile(filePath, opened.content, 'utf8')

    await expect(saveDocumentFile({
      filePath,
      content: opened.content.replace('#ffffff', '#00ff00'),
      expectedHash: opened.contentHash,
      expectedIdentity: opened.fileIdentity,
    })).rejects.toThrow('replaced on disk')
    await expect(fs.readFile(filePath, 'utf8')).resolves.toBe(opened.content)
  })

  it('saves in place and advances the content hash without changing identity', async () => {
    const directory = await temporaryDirectory()
    const filePath = await createNewFile(directory, 'Saved.excalidraw', 'excalidraw')
    const opened = await readDocumentFile(filePath)
    const nextContent = opened.content.replace('#ffffff', '#123456')

    const saved = await saveDocumentFile({
      filePath,
      content: nextContent,
      expectedHash: opened.contentHash,
      expectedIdentity: opened.fileIdentity,
    })

    expect(saved.contentHash).not.toBe(opened.contentHash)
    expect(saved.fileIdentity).toBe(opened.fileIdentity)
    await expect(fs.readFile(filePath, 'utf8')).resolves.toBe(nextContent)
  })

  it('creates a no-clobber Save As destination and rejects the source path', async () => {
    const directory = await temporaryDirectory()
    const sourcePath = await createNewFile(directory, 'Source.excalidraw', 'excalidraw')
    const source = await readDocumentFile(sourcePath)
    const destination = path.join(directory, 'Copy.excalidraw')

    const saved = await saveDocumentFileAs({
      filePath: destination,
      content: source.content,
      openPaths: [sourcePath],
      sourcePath,
      isRecovery: false,
    })
    expect(saved.fileIdentity).toBeTruthy()
    await expect(fs.readFile(destination, 'utf8')).resolves.toBe(source.content)

    await expect(saveDocumentFileAs({
      filePath: sourcePath,
      content: source.content,
      openPaths: [],
      sourcePath,
      isRecovery: true,
    })).rejects.toThrow('different destination')
  })

  it('filters hidden entries and computes recursive deletion scope', async () => {
    const directory = await temporaryDirectory()
    const folder = path.join(directory, 'Folder')
    await fs.mkdir(folder)
    const visible = await createNewFile(folder, 'Visible.excalidraw', 'excalidraw')
    await createNewFile(directory, '.Hidden.excalidraw', 'excalidraw')

    const tree = await getFileTree(directory)
    const matches = await getDeletionScopeMatches(
      folder,
      true,
      [visible, path.join(directory, 'Outside.excalidraw')]
    )

    expect(tree).toHaveLength(1)
    expect(tree[0].children).toHaveLength(1)
    expect(matches).toEqual([true, false])
  })
})