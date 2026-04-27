import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { hasFeature, isSuperuser } from '../lib/featureGates'

describe('hasFeature', () => {
  describe('starter tier', () => {
    it('ask_cfo → false', () => expect(hasFeature('starter', 'ask_cfo')).toBe(false))
    it('ai_insights → false', () => expect(hasFeature('starter', 'ai_insights')).toBe(false))
    it('quickbooks_sync → false', () => expect(hasFeature('starter', 'quickbooks_sync')).toBe(false))
    it('forecasting → false', () => expect(hasFeature('starter', 'forecasting')).toBe(false))
  })

  describe('core tier', () => {
    it('ask_cfo → true', () => expect(hasFeature('core', 'ask_cfo')).toBe(true))
    it('ai_insights → true', () => expect(hasFeature('core', 'ai_insights')).toBe(true))
    it('quickbooks_sync → true', () => expect(hasFeature('core', 'quickbooks_sync')).toBe(true))
    it('xero_sync → true', () => expect(hasFeature('core', 'xero_sync')).toBe(true))
    it('forecasting → false', () => expect(hasFeature('core', 'forecasting')).toBe(false))
    it('cfo_call → false', () => expect(hasFeature('core', 'cfo_call')).toBe(false))
  })

  describe('growth tier', () => {
    it('ask_cfo → true', () => expect(hasFeature('growth', 'ask_cfo')).toBe(true))
    it('forecasting → true', () => expect(hasFeature('growth', 'forecasting')).toBe(true))
    it('xero_sync → true', () => expect(hasFeature('growth', 'xero_sync')).toBe(true))
    it('cfo_call → false', () => expect(hasFeature('growth', 'cfo_call')).toBe(false))
  })

  describe('advisory tier', () => {
    it('forecasting → true', () => expect(hasFeature('advisory', 'forecasting')).toBe(true))
    it('cfo_call → true', () => expect(hasFeature('advisory', 'cfo_call')).toBe(true))
    it('team_seats → true', () => expect(hasFeature('advisory', 'team_seats')).toBe(true))
    it('bank_sync → true', () => expect(hasFeature('advisory', 'bank_sync')).toBe(true))
  })

  describe('superuser bypass', () => {
    beforeEach(() => {
      vi.stubEnv('NODE_ENV', 'development')
      vi.stubEnv('SUPERUSER_EMAILS', 'admin@example.com, dev@example.com')
    })

    afterEach(() => {
      vi.unstubAllEnvs()
    })

    it('starter + superuser email unlocks core feature', () => {
      expect(hasFeature('starter', 'ask_cfo', 'admin@example.com')).toBe(true)
    })

    it('starter + superuser email unlocks advisory feature', () => {
      expect(hasFeature('starter', 'cfo_call', 'admin@example.com')).toBe(true)
    })

    it('no email passed → normal gate applies', () => {
      expect(hasFeature('starter', 'ask_cfo')).toBe(false)
    })

    it('unknown email → normal gate applies', () => {
      expect(hasFeature('starter', 'ask_cfo', 'stranger@example.com')).toBe(false)
    })
  })
})

describe('isSuperuser', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('SUPERUSER_EMAILS', 'admin@example.com, DEV@EXAMPLE.COM')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns true for listed email in development', () => {
    expect(isSuperuser('admin@example.com')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(isSuperuser('ADMIN@EXAMPLE.COM')).toBe(true)
    expect(isSuperuser('dev@example.com')).toBe(true)
  })

  it('returns false for unlisted email', () => {
    expect(isSuperuser('other@example.com')).toBe(false)
  })

  it('returns false in production even if email is listed', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(isSuperuser('admin@example.com')).toBe(false)
  })
})
