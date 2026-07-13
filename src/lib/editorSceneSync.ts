type SceneFlusher = () => void

const sceneFlushers = new Map<string, SceneFlusher>()

export function registerEditorSceneFlusher(
  tabId: string,
  flusher: SceneFlusher
): () => void {
  sceneFlushers.set(tabId, flusher)

  return () => {
    if (sceneFlushers.get(tabId) === flusher) {
      sceneFlushers.delete(tabId)
    }
  }
}

export function flushPendingEditorScene(tabId?: string): void {
  if (tabId) {
    sceneFlushers.get(tabId)?.()
    return
  }

  for (const flusher of sceneFlushers.values()) {
    flusher()
  }
}
