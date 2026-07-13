import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TIMING } from '../constants'
import { useStore } from '../store/useStore'
import { mockOnFileSystemChange } from '../test/setup'
import { useFileSystemChangeListener } from './useFileSystemChangeListener'

const originalLoadFileTree = useStore.getState().loadFileTree
const originalReconcile =
  useStore.getState().reconcileActiveFileAfterExternalChange
let fileSystemChangeListener: (() => void) | null = null

beforeEach(() => {
  vi.useFakeTimers()
  fileSystemChangeListener = null
  mockOnFileSystemChange.mockImplementation((listener) => {
    fileSystemChangeListener = listener as () => void
    return vi.fn()
  })
})

afterEach(() => {
  vi.useRealTimers()
  useStore.setState({
    currentDirectory: null,
    loadFileTree: originalLoadFileTree,
    reconcileActiveFileAfterExternalChange: originalReconcile,
  })
})

describe('useFileSystemChangeListener', () => {
  it('coalesces a burst into one tree refresh and reconciliation', async () => {
    const loadFileTree = vi.fn().mockResolvedValue(undefined)
    const reconcile = vi.fn().mockResolvedValue(undefined)
    useStore.setState({
      currentDirectory: '/drawings',
      loadFileTree,
      reconcileActiveFileAfterExternalChange: reconcile,
    })
    renderHook(() => useFileSystemChangeListener('/drawings'))

    act(() => {
      fileSystemChangeListener?.()
      fileSystemChangeListener?.()
      fileSystemChangeListener?.()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TIMING.FILE_SYSTEM_CHANGE_DELAY - 1)
    })
    expect(loadFileTree).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })

    expect(loadFileTree).toHaveBeenCalledOnce()
    expect(loadFileTree).toHaveBeenCalledWith('/drawings')
    expect(reconcile).toHaveBeenCalledOnce()
  })

  it('runs one trailing refresh when changes arrive during a refresh', async () => {
    let resolveFirstRefresh!: () => void
    const loadFileTree = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<void>((resolve) => { resolveFirstRefresh = resolve })
      )
      .mockResolvedValue(undefined)
    const reconcile = vi.fn().mockResolvedValue(undefined)
    useStore.setState({
      currentDirectory: '/drawings',
      loadFileTree,
      reconcileActiveFileAfterExternalChange: reconcile,
    })
    renderHook(() => useFileSystemChangeListener('/drawings'))

    act(() => fileSystemChangeListener?.())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TIMING.FILE_SYSTEM_CHANGE_DELAY)
    })
    expect(loadFileTree).toHaveBeenCalledOnce()

    act(() => {
      fileSystemChangeListener?.()
      fileSystemChangeListener?.()
      resolveFirstRefresh()
    })
    await act(async () => {
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(TIMING.FILE_SYSTEM_CHANGE_DELAY)
    })

    expect(loadFileTree).toHaveBeenCalledTimes(2)
    expect(reconcile).toHaveBeenCalledTimes(2)
  })

  it('does not reconcile after the listener is disposed during a refresh', async () => {
    let resolveRefresh!: () => void
    const loadFileTree = vi.fn().mockImplementation(
      () => new Promise<void>((resolve) => { resolveRefresh = resolve })
    )
    const reconcile = vi.fn().mockResolvedValue(undefined)
    useStore.setState({
      currentDirectory: '/drawings',
      loadFileTree,
      reconcileActiveFileAfterExternalChange: reconcile,
    })
    const { unmount } = renderHook(() =>
      useFileSystemChangeListener('/drawings')
    )

    act(() => fileSystemChangeListener?.())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TIMING.FILE_SYSTEM_CHANGE_DELAY)
    })
    expect(loadFileTree).toHaveBeenCalledOnce()

    unmount()
    await act(async () => {
      resolveRefresh()
      await Promise.resolve()
    })

    expect(reconcile).not.toHaveBeenCalled()
  })
})