import { describe, it, expect } from 'vitest'
import { isNewUser, parseSuperuserEmails } from '../lib/onboarding'
import { currentRunway } from '../lib/calculations'

const supers = parseSuperuserEmails('ray@elidan.ai, Admin@Example.com')

describe('parseSuperuserEmails', () => {
  it('trims, lowercases and drops empties', () =>
    expect(parseSuperuserEmails(' ray@elidan.ai ,, Admin@Example.com ')).toEqual([
      'ray@elidan.ai',
      'admin@example.com',
    ]))
  it('handles undefined', () => expect(parseSuperuserEmails(undefined)).toEqual([]))
})

describe('isNewUser', () => {
  const base = {
    monthsCount: 0,
    onboardingCompletedAt: null,
    email: 'rayandumasia@gmail.com',
    superuserEmails: supers,
  }

  it('no data + not completed + not superuser → true', () =>
    expect(isNewUser(base)).toBe(true))
  it('has data → false', () =>
    expect(isNewUser({ ...base, monthsCount: 3 })).toBe(false))
  it('onboarding completed → false', () =>
    expect(isNewUser({ ...base, onboardingCompletedAt: '2026-09-25T10:00:00Z' })).toBe(false))
  it('superuser with no data → false', () =>
    expect(isNewUser({ ...base, email: 'ray@elidan.ai' })).toBe(false))
  it('superuser match is case-insensitive', () =>
    expect(isNewUser({ ...base, email: 'ADMIN@example.com' })).toBe(false))
  it('missing email is treated as a regular user', () =>
    expect(isNewUser({ ...base, email: null })).toBe(true))
  it('undefined completed_at (column not yet migrated) → true', () =>
    expect(isNewUser({ ...base, onboardingCompletedAt: undefined })).toBe(true))
})

describe('currentRunway', () => {
  // Scenario A — healthy: $300k cash, $30k burn → 10 months
  it('Scenario A: healthy runway', () =>
    expect(currentRunway(300_000, [30_000, 30_000, 30_000])).toBe(10))
  // Scenario C — critical: $50k cash, $25k burn → 2 months
  it('Scenario C: critical runway', () =>
    expect(currentRunway(50_000, [25_000, 25_000, 25_000])).toBe(2))
  it('averages only the 3 most recent months', () =>
    expect(currentRunway(120_000, [20_000, 40_000, 30_000, 999_999])).toBe(4))
  it('no cash → null', () => expect(currentRunway(null, [10_000])).toBeNull())
  it('no expenses → null', () => expect(currentRunway(100_000, [])).toBeNull())
  it('zero burn → null', () => expect(currentRunway(100_000, [0, 0])).toBeNull())
})
