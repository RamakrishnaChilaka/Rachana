import { describe, expect, it, vi } from 'vitest'
import {
  flushPendingEditorScene,
  registerEditorSceneFlusher,
} from './editorSceneSync'

describe('editor scene synchronization', () => {
  it('flushes a registered tab until it is unregistered', () => {
    const flusher = vi.fn()
    const unregister = registerEditorSceneFlusher('tab-1', flusher)

    flushPendingEditorScene('tab-1')
    unregister()
    flushPendingEditorScene('tab-1')

    expect(flusher).toHaveBeenCalledTimes(1)
  })

  it('keeps a newer flusher when an older editor unregisters', () => {
    const olderFlusher = vi.fn()
    const newerFlusher = vi.fn()
    const unregisterOlder = registerEditorSceneFlusher(
      'shared-tab',
      olderFlusher
    )
    const unregisterNewer = registerEditorSceneFlusher(
      'shared-tab',
      newerFlusher
    )

    unregisterOlder()
    flushPendingEditorScene('shared-tab')
    unregisterNewer()

    expect(olderFlusher).not.toHaveBeenCalled()
    expect(newerFlusher).toHaveBeenCalledTimes(1)
  })

  it('flushes all mounted editors at a lifecycle boundary', () => {
    const firstFlusher = vi.fn()
    const secondFlusher = vi.fn()
    const unregisterFirst = registerEditorSceneFlusher(
      'all-tab-1',
      firstFlusher
    )
    const unregisterSecond = registerEditorSceneFlusher(
      'all-tab-2',
      secondFlusher
    )

    flushPendingEditorScene()
    unregisterFirst()
    unregisterSecond()

    expect(firstFlusher).toHaveBeenCalledTimes(1)
    expect(secondFlusher).toHaveBeenCalledTimes(1)
  })
})
