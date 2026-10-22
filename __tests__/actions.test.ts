import { describe, it, expect } from 'vitest'
import {
  alertToActionPrefill,
  getActionLimitState,
  validateActionCreate,
  validateActionUpdate,
} from '../lib/actions'
import type { Alert } from '../lib/types'

const alert = (code: Alert['code'], severity: Alert['severity']): Alert => ({
  code,
  severity,
  title: 'Title',
  message: `${code} message`,
})

describe('alertToActionPrefill', () => {
  it.each([
    ['RUNWAY_DANGER', 'danger', 'Extend cash runway', 'runway_improvement', 'Runway extended to a safe level'],
    ['RUNWAY_WARNING', 'warning', 'Extend cash runway', 'runway_improvement', 'Runway is above my warning threshold'],
    ['BURN_RATE_SPIKE', 'warning', 'Reduce monthly burn', 'expense_reduction', 'Monthly burn is back in line with previous months'],
    ['CASH_BELOW_RESERVE', 'danger', 'Rebuild cash reserve', 'expense_reduction', 'Cash balance is back above my minimum reserve'],
    ['HIGH_AR', 'warning', 'Collect outstanding invoices', 'revenue_increase', 'Outstanding invoices are collected and cash is in'],
  ] as const)('%s → %s', (code, severity, name, goal_type, description) => {
    expect(alertToActionPrefill(alert(code, severity))).toEqual({
      name,
      goal_type,
      description,
      linked_alert_code: code,
    })
  })

  it('description is outcome-framed, never the diagnostic alert message', () => {
    expect(alertToActionPrefill(alert('HIGH_AR', 'warning'))?.description).not.toBe('HIGH_AR message')
  })

  it('success alerts get no prefill', () => {
    expect(alertToActionPrefill(alert('REVENUE_GROWTH', 'success'))).toBeNull()
  })

  it('unmapped danger/warning codes get no prefill', () => {
    expect(alertToActionPrefill(alert('REVENUE_GROWTH', 'warning'))).toBeNull()
  })
})

describe('getActionLimitState', () => {
  it('starter 7/10 → neither near nor at limit', () =>
    expect(getActionLimitState('starter', 7)).toEqual({ limit: 10, activeCount: 7, atLimit: false, nearLimit: false }))
  it('starter 8/10 → near limit', () =>
    expect(getActionLimitState('starter', 8)).toMatchObject({ atLimit: false, nearLimit: true }))
  it('starter 10/10 → at limit, not near', () =>
    expect(getActionLimitState('starter', 10)).toMatchObject({ atLimit: true, nearLimit: false }))
  it('core 40/50 → near limit', () =>
    expect(getActionLimitState('core', 40)).toMatchObject({ limit: 50, nearLimit: true }))
  it('growth is unlimited', () =>
    expect(getActionLimitState('growth', 1000)).toEqual({ limit: null, activeCount: 1000, atLimit: false, nearLimit: false }))
  it('advisory is unlimited', () =>
    expect(getActionLimitState('advisory', 1000).atLimit).toBe(false))
  it('suspended is always at limit', () =>
    expect(getActionLimitState('suspended', 0).atLimit).toBe(true))
})

describe('validateActionCreate', () => {
  it('accepts a minimal body and defaults optional fields', () => {
    const r = validateActionCreate({ name: '  Cut SaaS spend  ', goal_type: 'expense_reduction' })
    expect(r).toEqual({
      ok: true,
      value: {
        business_id: null,
        name: 'Cut SaaS spend',
        description: null,
        goal_type: 'expense_reduction',
        goal_value: null,
        goal_unit: null,
        status: 'not_started',
        due_date: null,
        linked_alert_code: null,
        actual_impact: null,
        actual_impact_notes: null,
      },
    })
  })

  it('drops user_id and business_id from the client', () => {
    const r = validateActionCreate({ name: 'x', goal_type: 'risk_mitigation', user_id: 'evil', business_id: 'evil' })
    expect(r.ok && r.value.business_id).toBeNull()
    expect(r.ok && 'user_id' in r.value).toBe(false)
  })

  it('requires name', () => expect(validateActionCreate({ goal_type: 'risk_mitigation' }).ok).toBe(false))
  it('rejects blank name', () => expect(validateActionCreate({ name: '   ', goal_type: 'risk_mitigation' }).ok).toBe(false))
  it('rejects name over 200 chars', () =>
    expect(validateActionCreate({ name: 'a'.repeat(201), goal_type: 'risk_mitigation' }).ok).toBe(false))
  it('rejects unknown goal_type', () =>
    expect(validateActionCreate({ name: 'x', goal_type: 'world_domination' }).ok).toBe(false))
  it('rejects description over 500 chars', () =>
    expect(validateActionCreate({ name: 'x', goal_type: 'risk_mitigation', description: 'a'.repeat(501) }).ok).toBe(false))
  it('rejects non-numeric goal_value', () =>
    expect(validateActionCreate({ name: 'x', goal_type: 'risk_mitigation', goal_value: 'lots' }).ok).toBe(false))
  it('rejects bad due_date', () =>
    expect(validateActionCreate({ name: 'x', goal_type: 'risk_mitigation', due_date: '11/03/2026' }).ok).toBe(false))
  it('rejects non-object body', () => expect(validateActionCreate(null).ok).toBe(false))
})

describe('validateActionUpdate', () => {
  it('returns only provided fields', () =>
    expect(validateActionUpdate({ status: 'completed', actual_impact: 4200 })).toEqual({
      ok: true,
      value: { status: 'completed', actual_impact: 4200 },
    }))
  it('allows clearing optional fields', () =>
    expect(validateActionUpdate({ due_date: null, description: '' })).toEqual({
      ok: true,
      value: { due_date: null, description: null },
    }))
  it('rejects empty update', () => expect(validateActionUpdate({ foo: 1 }).ok).toBe(false))
  it('rejects invalid status', () => expect(validateActionUpdate({ status: 'done' }).ok).toBe(false))
  it('rejects null status', () => expect(validateActionUpdate({ status: null }).ok).toBe(false))
  it('rejects blank name', () => expect(validateActionUpdate({ name: '' }).ok).toBe(false))
})
