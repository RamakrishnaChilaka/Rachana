import { invoke } from '@tauri-apps/api/core'
import { promptForName } from './namePrompt'
import { useStore } from '../store/useStore'

export async function selectWorkspace(): Promise<boolean> {
  const directory = await invoke<string | null>('select_directory')
  if (!directory) {
    return false
  }

  return useStore.getState().loadDirectory(directory)
}

async function ensureWorkspace(): Promise<boolean> {
  return Boolean(useStore.getState().currentDirectory) || selectWorkspace()
}

export async function createDrawing(): Promise<void> {
  if (!(await ensureWorkspace())) {
    return
  }

  const fileName = await promptForName({
    title: 'Drawing name',
    defaultValue: 'Untitled.excalidraw',
    confirmLabel: 'Create drawing',
  })
  if (!fileName) {
    return
  }

  await useStore.getState().createNewFile(fileName)
}

export async function createWorkspaceFolder(): Promise<void> {
  if (!(await ensureWorkspace())) {
    return
  }

  const folderName = await promptForName({
    title: 'Folder name',
    defaultValue: 'New Folder',
    confirmLabel: 'Create folder',
  })
  if (!folderName) {
    return
  }

  await useStore.getState().createNewFolder(folderName)
}
