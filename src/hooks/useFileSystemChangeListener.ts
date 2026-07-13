import { useEffect } from 'react'
import { listen } from '@tauri-apps/api/event'
import { TIMING } from '../constants'
import { pathsEqual } from '../lib/path'
import { useStore } from '../store/useStore'

export function useFileSystemChangeListener(currentDirectory: string | null) {
  useEffect(() => {
    if (!currentDirectory) return

    let disposed = false
    let refreshTimer: number | null = null
    let refreshInProgress = false
    let refreshAgain = false

    const isCurrentDirectory = () => {
      const latestDirectory = useStore.getState().currentDirectory
      return (
        latestDirectory !== null &&
        pathsEqual(latestDirectory, currentDirectory)
      )
    }

    const scheduleRefresh = () => {
      if (disposed) return
      if (refreshInProgress) {
        refreshAgain = true
        return
      }
      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer)
      }
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null
        void refresh()
      }, TIMING.FILE_SYSTEM_CHANGE_DELAY)
    }

    const refresh = async () => {
      if (disposed || refreshInProgress) return
      refreshInProgress = true

      try {
        if (!isCurrentDirectory()) return
        await useStore.getState().loadFileTree(currentDirectory)
        if (disposed || !isCurrentDirectory()) return
        await useStore.getState().reconcileActiveFileAfterExternalChange()
      } catch (error) {
        console.error('Failed to process file system changes:', error)
      } finally {
        refreshInProgress = false
        if (refreshAgain && !disposed) {
          refreshAgain = false
          scheduleRefresh()
        }
      }
    }

    const unlisten = listen('file-system-change', scheduleRefresh)

    return () => {
      disposed = true
      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer)
      }
      void unlisten.then((fn) => fn())
    }
  }, [currentDirectory])
}