type ContentFlusher = () => void

const contentFlushers = new Map<string, ContentFlusher>()

export function registerEditorContentFlusher(
  tabId: string,
  flusher: ContentFlusher
): () => void {
  contentFlushers.set(tabId, flusher)

  return () => {
    if (contentFlushers.get(tabId) === flusher) {
      contentFlushers.delete(tabId)
    }
  }
}

export function flushPendingEditorContent(tabId?: string): void {
  if (tabId) {
    contentFlushers.get(tabId)?.()
    return
  }

  for (const flusher of contentFlushers.values()) {
    flusher()
  }
}