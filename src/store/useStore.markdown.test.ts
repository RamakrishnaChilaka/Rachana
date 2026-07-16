import { beforeEach, describe, expect, it } from 'vitest'
import { mockInvoke, saveResult } from '../test/setup'
import type { MarkdownOpenTab } from '../types'
import { useStore } from './useStore'

const markdownFile = {
  kind: 'markdown' as const,
  name: 'Notes.md',
  path: '/drawings/Notes.md',
  modified: false,
}

function markdownDisk(content: string, hash = 'markdown-hash') {
  return {
    content,
    content_hash: hash,
    file_identity: 'markdown-identity',
  }
}

beforeEach(() => {
  useStore.setState({
    currentDirectory: '/drawings',
    files: [markdownFile],
    fileTree: [{
      ...markdownFile,
      is_directory: false,
    }],
    activeFile: null,
    fileContent: null,
    activeFileLoadSource: null,
    isDirty: false,
    openTabs: [],
    saveOperations: {},
  })
})

describe('Markdown tab lifecycle', () => {
  it('opens Markdown as plain text without canvas scene state', async () => {
    mockInvoke.mockResolvedValueOnce(markdownDisk('# Notes'))

    await useStore.getState().loadFile(markdownFile)

    const state = useStore.getState()
    expect(state.activeFile).toMatchObject(markdownFile)
    expect(state.fileContent).toBe('# Notes')
    expect(state.openTabs[0]).toMatchObject({
      kind: 'markdown',
      cachedContent: '# Notes',
      contentVersion: 0,
    })
    expect(state.openTabs[0].cachedScene).toBeUndefined()
  })

  it('saves the latest version-guarded Markdown content', async () => {
    mockInvoke
      .mockResolvedValueOnce(markdownDisk('before'))
      .mockResolvedValueOnce(saveResult('saved-markdown-hash', 'markdown-identity'))
    await useStore.getState().loadFile(markdownFile)
    const tab = useStore.getState().openTabs[0] as MarkdownOpenTab

    useStore.getState().updateMarkdownContent(
      tab.tabId,
      tab.contentVersion,
      'after'
    )
    useStore.getState().setIsDirty(true)
    useStore.getState().markFileAsModified(tab.path, true, tab.tabId)

    await expect(useStore.getState().saveCurrentFile()).resolves.toBe(true)
    expect(mockInvoke).toHaveBeenCalledWith('save_file', {
      filePath: tab.path,
      content: 'after',
      expectedHash: tab.contentHash,
      expectedIdentity: tab.fileIdentity,
    })
    expect(useStore.getState().openTabs[0]).toMatchObject({
      kind: 'markdown',
      cachedContent: 'after',
      contentHash: 'saved-markdown-hash',
      modified: false,
    })
  })

  it('reloads a clean Markdown tab when disk content changes', async () => {
    mockInvoke.mockResolvedValueOnce(markdownDisk('before'))
    await useStore.getState().loadFile(markdownFile)
    const opened = useStore.getState().openTabs[0]
  mockInvoke.mockResolvedValueOnce(markdownDisk('from disk', 'disk-hash'))

    await useStore.getState().reconcileActiveFileAfterExternalChange()

    expect(useStore.getState().openTabs[0]).toMatchObject({
      tabId: opened.tabId,
      kind: 'markdown',
      cachedContent: 'from disk',
      contentHash: 'disk-hash',
      contentVersion: opened.contentVersion + 1,
    })
    expect(useStore.getState().fileContent).toBe('from disk')
  })

  it('preserves local Markdown and marks a conflict when disk changes', async () => {
    mockInvoke.mockResolvedValueOnce(markdownDisk('before'))
    await useStore.getState().loadFile(markdownFile)
    const tab = useStore.getState().openTabs[0] as MarkdownOpenTab
    useStore.getState().updateMarkdownContent(
      tab.tabId,
      tab.contentVersion,
      'local edit'
    )
    useStore.getState().setIsDirty(true)
    useStore.getState().markFileAsModified(tab.path, true, tab.tabId)
    mockInvoke.mockResolvedValueOnce(markdownDisk('external edit', 'external-hash'))

    await useStore.getState().reconcileActiveFileAfterExternalChange()

    expect(useStore.getState().openTabs[0]).toMatchObject({
      kind: 'markdown',
      cachedContent: 'local edit',
      modified: true,
      externalConflict: 'modified-on-disk',
    })
    expect(useStore.getState().fileContent).toBe('local edit')
  })

  it('keeps a deleted dirty Markdown note as a recovery tab', async () => {
    mockInvoke.mockResolvedValueOnce(markdownDisk('before'))
    await useStore.getState().loadFile(markdownFile)
    const tab = useStore.getState().openTabs[0] as MarkdownOpenTab
    useStore.getState().updateMarkdownContent(
      tab.tabId,
      tab.contentVersion,
      'recover me'
    )
    useStore.getState().setIsDirty(true)
    useStore.getState().markFileAsModified(tab.path, true, tab.tabId)
    mockInvoke.mockRejectedValueOnce(new Error('no such file'))

    await useStore.getState().reconcileActiveFileAfterExternalChange()

    expect(useStore.getState().openTabs[0]).toMatchObject({
      kind: 'markdown',
      cachedContent: 'recover me',
      modified: true,
      recoveryState: 'deleted-on-disk',
    })
  })

  it('uses a Markdown Save As dialog and preserves plain text', async () => {
    mockInvoke
      .mockResolvedValueOnce(markdownDisk('local note'))
      .mockResolvedValueOnce('/drawings/Copy.md')
      .mockResolvedValueOnce(saveResult('copy-hash', 'copy-identity'))
    await useStore.getState().loadFile(markdownFile)
    const tab = useStore.getState().openTabs[0]

    await expect(useStore.getState().saveTabAs(tab.path, undefined, tab.tabId))
      .resolves.toBe('/drawings/Copy.md')
    expect(mockInvoke).toHaveBeenCalledWith('select_save_file_path', {
      kind: 'markdown',
    })
    expect(mockInvoke).toHaveBeenCalledWith('save_file_as', expect.objectContaining({
      filePath: '/drawings/Copy.md',
      content: 'local note',
    }))
    expect(useStore.getState().openTabs[0]).toMatchObject({
      kind: 'markdown',
      path: '/drawings/Copy.md',
      cachedContent: 'local note',
    })
  })

  it('preserves the Markdown extension when renaming', async () => {
    mockInvoke.mockResolvedValueOnce(markdownDisk('note'))
    await useStore.getState().loadFile(markdownFile)
    mockInvoke.mockResolvedValueOnce('/drawings/Renamed.md')

    await useStore.getState().renameFile(markdownFile.path, 'Renamed')

    expect(mockInvoke).toHaveBeenCalledWith('rename_file', {
      oldPath: markdownFile.path,
      newName: 'Renamed.md',
    })
    expect(useStore.getState().openTabs[0]).toMatchObject({
      kind: 'markdown',
      name: 'Renamed.md',
      path: '/drawings/Renamed.md',
    })
  })
})
