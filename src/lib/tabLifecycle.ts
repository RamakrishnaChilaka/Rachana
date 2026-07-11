import type { OpenTab } from '../types'

export type AppCloseState =
  | 'clear'
  | 'single-active-unsaved'
  | 'multiple-or-inactive-unsaved'

export function isUnsavedTab(tab: OpenTab): boolean {
  return (
    tab.modified ||
    tab.recoveryState === 'deleted-on-disk' ||
    tab.externalConflict === 'modified-on-disk'
  )
}

export function getUnsavedTabs(openTabs: OpenTab[]): OpenTab[] {
  return openTabs.filter(isUnsavedTab)
}

export function hasUnsavedTabs(openTabs: OpenTab[]): boolean {
  return getUnsavedTabs(openTabs).length > 0
}

export function getAppCloseState(
  openTabs: OpenTab[],
  activePath: string | null
): AppCloseState {
  const unsavedTabs = getUnsavedTabs(openTabs)
  if (unsavedTabs.length === 0) {
    return 'clear'
  }
  if (unsavedTabs.length === 1 && unsavedTabs[0].path === activePath) {
    return 'single-active-unsaved'
  }
  return 'multiple-or-inactive-unsaved'
}

interface AppCloseActions {
  getCurrentState: () => { openTabs: OpenTab[]; activePath: string | null }
  confirmSave: () => Promise<boolean>
  confirmDiscard: () => Promise<boolean>
  saveActive: () => Promise<boolean>
  notifyBlocked: (unsavedCount: number) => Promise<void>
  forceClose: () => Promise<void>
}

export async function handleAppCloseRequest(
  openTabs: OpenTab[],
  activePath: string | null,
  actions: AppCloseActions
): Promise<boolean> {
  const closeState = getAppCloseState(openTabs, activePath)
  if (closeState === 'multiple-or-inactive-unsaved') {
    await actions.notifyBlocked(getUnsavedTabs(openTabs).length)
    return false
  }
  if (closeState === 'clear') {
    await actions.forceClose()
    return true
  }

  if (await actions.confirmSave()) {
    if (!(await actions.saveActive())) {
      return false
    }
    const current = actions.getCurrentState()
    const remainingUnsaved = getUnsavedTabs(current.openTabs)
    if (remainingUnsaved.length > 0) {
      await actions.notifyBlocked(remainingUnsaved.length)
      return false
    }
    await actions.forceClose()
    return true
  }

  if (await actions.confirmDiscard()) {
    const current = actions.getCurrentState()
    const additionalUnsaved = getUnsavedTabs(current.openTabs).filter(
      (tab) => tab.path !== activePath
    )
    if (additionalUnsaved.length > 0) {
      await actions.notifyBlocked(additionalUnsaved.length)
      return false
    }
    await actions.forceClose()
    return true
  }
  return false
}
