import { describe, expect, it, vi } from 'vitest'
import {
  flushPendingEditorContent,
  registerEditorContentFlusher,
} from './editorContentSync'

describe('editor content synchronization', () => {
  it('flushes a registered tab until it is unregistered', () => {
    const flusher = vi.fn()
    const unregister = registerEditorContentFlusher('tab-1', flusher)

    flushPendingEditorContent('tab-1')
    unregister()
    flushPendingEditorContent('tab-1')

    expect(flusher).toHaveBeenCalledTimes(1)
  })

  it('keeps a newer flusher when an older editor unregisters', () => {
    const olderFlusher = vi.fn()
    const newerFlusher = vi.fn()
    const unregisterOlder = registerEditorContentFlusher(
      'shared-tab',
      olderFlusher
    )
    const unregisterNewer = registerEditorContentFlusher(
      'shared-tab',
      newerFlusher
    )

    unregisterOlder()
    flushPendingEditorContent('shared-tab')
    unregisterNewer()

    expect(olderFlusher).not.toHaveBeenCalled()
    expect(newerFlusher).toHaveBeenCalledTimes(1)
  })

  it('flushes all mounted editors at a lifecycle boundary', () => {
    const firstFlusher = vi.fn()
    const secondFlusher = vi.fn()
    const unregisterFirst = registerEditorContentFlusher(
      'all-tab-1',
      firstFlusher
    )
    const unregisterSecond = registerEditorContentFlusher(
      'all-tab-2',
      secondFlusher
    )

    flushPendingEditorContent()
    unregisterFirst()
    unregisterSecond()

    expect(firstFlusher).toHaveBeenCalledTimes(1)
    expect(secondFlusher).toHaveBeenCalledTimes(1)
  })
})
