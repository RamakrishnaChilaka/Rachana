import type { ExcalidrawFile, OpenTab } from '../types'

export type SaveOperations = Record<string, string>
export type DocumentSaveStatus =
  | 'Saving…'
  | 'Save As required'
  | 'Changed on disk'
  | 'Unsaved changes'
  | 'Saved'

export function isPathSaving(
  saveOperations: SaveOperations,
  filePath: string
): boolean {
  return Object.values(saveOperations).some((operationPath) => operationPath === filePath)
}

export function rekeySaveOperation(
  saveOperations: SaveOperations,
  operationId: string | undefined,
  oldPath: string,
  newPath: string
): SaveOperations {
  if (!operationId || saveOperations[operationId] !== oldPath) {
    return saveOperations
  }

  return {
    ...saveOperations,
    [operationId]: newPath,
  }
}

export function getActiveDocumentSaveStatus(
  activeFile: ExcalidrawFile | null,
  openTabs: OpenTab[],
  isDirty: boolean,
  saveOperations: SaveOperations
): DocumentSaveStatus | null {
  if (!activeFile) {
    return null
  }
  if (isPathSaving(saveOperations, activeFile.path)) {
    return 'Saving…'
  }

  const activeTab = openTabs.find((tab) =>
    activeFile.tabId
      ? tab.tabId === activeFile.tabId
      : tab.path === activeFile.path
  )
  if (activeTab?.recoveryState === 'deleted-on-disk') {
    return 'Save As required'
  }
  if (activeTab?.externalConflict === 'modified-on-disk') {
    return 'Changed on disk'
  }
  if (isDirty || activeTab?.modified || activeFile.modified) {
    return 'Unsaved changes'
  }
  return 'Saved'
}
