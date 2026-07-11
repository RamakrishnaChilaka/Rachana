import { describe, expect, it } from 'vitest'
import { convertPreferencesFromRust, convertPreferencesToRust } from './preferences'
import {
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
} from './layout'

describe('preference conversion', () => {
  it('uses a safe default for preferences created before sidebar sizing existed', () => {
    expect(convertPreferencesFromRust({}).sidebarWidth).toBe(DEFAULT_SIDEBAR_WIDTH)
  })

  it('loads snake_case sidebar width values and clamps invalid bounds', () => {
    expect(convertPreferencesFromRust({ sidebar_width: 220 }).sidebarWidth).toBe(220)
    expect(convertPreferencesFromRust({ sidebar_width: 100 }).sidebarWidth).toBe(MIN_SIDEBAR_WIDTH)
    expect(convertPreferencesFromRust({ sidebar_width: 500 }).sidebarWidth).toBe(MAX_SIDEBAR_WIDTH)
  })

  it('persists sidebar width using the Rust preference shape', () => {
    const preferences = convertPreferencesFromRust({ sidebar_width: 272 })
    expect(convertPreferencesToRust(preferences).sidebar_width).toBe(272)
  })
})
