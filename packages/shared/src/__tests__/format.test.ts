import { describe, it, expect } from 'vitest'
import { formatKRW, formatKRWCompact } from '../format.js'

describe('formatKRW', () => {
  it('formats 1000000 as "1,000,000원"', () => {
    expect(formatKRW(1000000)).toBe('1,000,000원')
  })
  it('handles null', () => {
    expect(formatKRW(null)).toBe('')
  })
})

describe('formatKRWCompact', () => {
  it('formats 100000000 as "1억"', () => {
    expect(formatKRWCompact(100000000)).toBe('1억')
  })

  it('formats 1000000 as "1백만"', () => {
    expect(formatKRWCompact(1000000)).toBe('1백만')
  })

  it('handles null', () => {
    expect(formatKRWCompact(null)).toBe('')
  })
})
