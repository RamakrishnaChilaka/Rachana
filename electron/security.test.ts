// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { isTrustedRendererDocument } from './security'

describe('isTrustedRendererDocument', () => {
  it('allows query and fragment changes on the exact renderer document', () => {
    expect(isTrustedRendererDocument(
      'http://localhost:5173/',
      'http://localhost:5173/?mode=test#canvas'
    )).toBe(true)
  })

  it('rejects lookalike hosts and different file documents', () => {
    expect(isTrustedRendererDocument(
      'http://localhost:5173/',
      'http://localhost:5173.evil.example/'
    )).toBe(false)
    expect(isTrustedRendererDocument(
      'file:///opt/rachana/index.html',
      'file:///tmp/index.html'
    )).toBe(false)
  })
})