import { describe, expect, it } from 'vitest'
import {
  drawingDisplayName,
  normalizePathForComparison,
  pathBasename,
  pathsEqual,
} from './path'

describe('pathBasename', () => {
  it('extracts a directory name from POSIX paths', () => {
    expect(pathBasename('/Users/mira/Drawings')).toBe('Drawings')
  })

  it('extracts a directory name from Windows paths', () => {
    expect(pathBasename('C:\\Users\\Mira\\Drawings')).toBe('Drawings')
  })

  it('ignores trailing path separators', () => {
    expect(pathBasename('/Users/mira/Drawings/')).toBe('Drawings')
    expect(pathBasename('C:\\Users\\Mira\\Drawings\\')).toBe('Drawings')
  })
})

describe('cross-platform path identity', () => {
  it('normalizes Windows separators, casing, and trailing separators', () => {
    expect(normalizePathForComparison(String.raw`C:\Drawings\Plan.excalidraw`)).toBe(
      'c:/drawings/plan.excalidraw'
    )
    expect(
      pathsEqual(
        String.raw`C:\Drawings\Plan.excalidraw`,
        'c:/drawings/PLAN.excalidraw/'
      )
    ).toBe(true)
  })

  it('preserves case sensitivity for POSIX paths', () => {
    expect(pathsEqual('/drawings/Plan.excalidraw', '/drawings/plan.excalidraw')).toBe(false)
  })
})

describe('drawingDisplayName', () => {
  it('removes only a trailing Excalidraw extension', () => {
    expect(drawingDisplayName('Roadmap.excalidraw')).toBe('Roadmap')
    expect(drawingDisplayName('Roadmap.excalidraw.backup')).toBe('Roadmap.excalidraw.backup')
  })
})
