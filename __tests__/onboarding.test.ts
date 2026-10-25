import { describe, it, expect } from 'vitest'
import { isNewUser, parseSuperuserEmails } from '../lib/onboarding'
import { currentRunway } from '../lib/calculations'
import type { FinancialMonth } from '../lib/types'

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
  const month=(date:string,paid:number,collected=0)=>({month_date:date,total_expenses:paid,total_revenue:collected}) as FinancialMonth
  const three=(paid:number,collected=0)=>[
    month('2026-09-01',paid,collected),month('2026-08-01',paid,collected),month('2026-07-01',paid,collected),
  ]
  it('Scenario A: cash-generating activity has no depletion runway', () =>
    expect(currentRunway(300_000, three(30_000,35_000),new Date('2026-10-15'))).toBeNull())
  it('Scenario C: uses net reported cash burn', () =>
    expect(currentRunway(50_000, three(40_000,15_000),new Date('2026-10-15'))).toBe(2))
  it('averages only the 3 most recent consecutive months', () =>
    expect(currentRunway(120_000, [...three(40_000,10_000),month('2026-06-01',999_999,0)],new Date('2026-10-15'))).toBe(4))
  it('no cash → null', () => expect(currentRunway(null, three(10_000),new Date('2026-10-15'))).toBeNull())
  it('no expenses → null', () => expect(currentRunway(100_000, [])).toBeNull())
  it('zero net burn → null', () => expect(currentRunway(100_000, three(10_000,10_000),new Date('2026-10-15'))).toBeNull())
})
