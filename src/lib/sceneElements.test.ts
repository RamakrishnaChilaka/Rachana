import { describe, expect, it } from 'vitest'
import { didSceneElementsChange } from './sceneElements'

describe('didSceneElementsChange', () => {
  it('skips unchanged arrays and shallow copies of immutable elements', () => {
    const elements = [{ id: 'one' }, { id: 'two' }]

    expect(didSceneElementsChange(elements, elements)).toBe(false)
    expect(didSceneElementsChange(elements, [...elements])).toBe(false)
  })

  it('detects immutable element updates', () => {
    const first = { id: 'one', version: 1 }
    const previous = [first]
    const current = [{ ...first, version: 2 }]

    expect(didSceneElementsChange(previous, current)).toBe(true)
  })

  it('detects additions, removals, and reordering', () => {
    const first = { id: 'one' }
    const second = { id: 'two' }

    expect(didSceneElementsChange([first], [first, second])).toBe(true)
    expect(didSceneElementsChange([first, second], [first])).toBe(true)
    expect(didSceneElementsChange([first, second], [second, first])).toBe(true)
  })
})
