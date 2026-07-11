import { useEffect } from 'react'
import { TIMING } from '../constants'
import { isPathSaving } from '../lib/saveStatus'
import { useStore } from '../store/useStore'

export function useAutoSave() {
  useEffect(() => {
    const interval = window.setInterval(() => {
      const state = useStore.getState()
      const activePath = state.activeFile?.path
      if (!activePath || !state.isDirty || isPathSaving(state.saveOperations, activePath)) {
        return
      }

      const activeTab = state.openTabs.find((tab) =>
        state.activeFile?.tabId
          ? tab.tabId === state.activeFile.tabId
          : tab.path === activePath
      )
      if (
        activeTab?.recoveryState === 'deleted-on-disk' ||
        activeTab?.externalConflict === 'modified-on-disk'
      ) {
        return
      }

      void state.saveCurrentFile()
    }, TIMING.AUTO_SAVE_INTERVAL)

    return () => window.clearInterval(interval)
  }, [])
}
