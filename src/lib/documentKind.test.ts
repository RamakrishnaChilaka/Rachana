import { describe, expect, it } from 'vitest'
import {
  documentDisplayName,
  documentKindFromPath,
  ensureDocumentExtension,
} from './documentKind'

describe('document kinds', () => {
  it.each([
    ['Plan.excalidraw', 'excalidraw'],
    ['Notes.md', 'markdown'],
    ['README.MARKDOWN', 'markdown'],
    ['image.png', null],
  ] as const)('detects %s as %s', (filePath, expected) => {
    expect(documentKindFromPath(filePath)).toBe(expected)
  })

  it('normalizes display and creation names', () => {
    expect(documentDisplayName('Plan.excalidraw')).toBe('Plan')
    expect(documentDisplayName('Notes.md')).toBe('Notes')
    expect(ensureDocumentExtension('Notes', 'markdown')).toBe('Notes.md')
    expect(ensureDocumentExtension('Plan', 'excalidraw')).toBe('Plan.excalidraw')
  })
})