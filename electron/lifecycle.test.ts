// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { CloseCoordinator } from './lifecycle'

describe('CloseCoordinator', () => {
  it('deduplicates pending requests and permits a retry after veto', () => {
    const lifecycle = new CloseCoordinator()

    expect(lifecycle.request()).toBe(true)
    expect(lifecycle.request()).toBe(false)
    lifecycle.cancel()
    expect(lifecycle.request()).toBe(true)
  })

  it('allows native close only after renderer approval', () => {
    const lifecycle = new CloseCoordinator()

    lifecycle.request()
    expect(lifecycle.canClose).toBe(false)
    lifecycle.approve()
    expect(lifecycle.canClose).toBe(true)
    expect(lifecycle.request()).toBe(false)
  })
})