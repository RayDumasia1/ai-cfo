import { describe, it, expect } from 'vitest'
import {
  alertToActionPrefill,
  getActionLimitState,
  validateActionCreate,
  validateActionUpdate,
} from '../lib/actions'
import {
  ACTION_EMPTY_MESSAGES,
  countOverdue,
  filterAndSortActions,
  formatActualImpact,
  getTabCounts,
  isOverdue,
  localToday,
} from '../lib/actionList'
import type { Action, Alert } from '../lib/types'

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
    ['CUSTOMER_COLLECTIONS_ZERO', 'warning', 'Review customer collections', 'revenue_increase', 'Confirm the zero is accurate and follow up on any delayed customer payments'],
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
        linked_forecast_version_id: null,
        linked_forecast_item_id: null,
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
  it('accepts traceable forecast linkage', () => {
    const r = validateActionCreate({ name: 'Address reserve risk', goal_type: 'risk_mitigation',
      linked_forecast_version_id: '11111111-1111-4111-8111-111111111111' })
    expect(r.ok && r.value.linked_forecast_version_id).toBe('11111111-1111-4111-8111-111111111111')
  })
  it('requires a forecast version when an item is linked', () => {
    expect(validateActionCreate({ name: 'Collect invoice', goal_type: 'revenue_increase',
      linked_forecast_item_id: '22222222-2222-4222-8222-222222222222' }).ok).toBe(false)
  })
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

// ─── Action list (Actions page) ───────────────────────────────────────────────

const TODAY = '2026-10-22'

const makeAction = (id: string, overrides: Partial<Action> = {}): Action => ({
  id,
  user_id: 'u1',
  business_id: null,
  name: id,
  description: null,
  goal_type: 'expense_reduction',
  goal_value: null,
  goal_unit: null,
  status: 'not_started',
  due_date: null,
  linked_alert_code: null,
  linked_forecast_version_id: null,
  linked_forecast_item_id: null,
  actual_impact: null,
  actual_impact_notes: null,
  completed_at: null,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  ...overrides,
})

const ids = (actions: Action[]) => actions.map((a) => a.id)

describe('isOverdue', () => {
  it('past due date → overdue', () => expect(isOverdue(makeAction('a', { due_date: '2026-10-21' }), TODAY)).toBe(true))
  it('due today → not overdue', () => expect(isOverdue(makeAction('a', { due_date: TODAY }), TODAY)).toBe(false))
  it('no due date → not overdue', () => expect(isOverdue(makeAction('a'), TODAY)).toBe(false))
  it('completed past due → not overdue', () =>
    expect(isOverdue(makeAction('a', { due_date: '2026-01-01', status: 'completed' }), TODAY)).toBe(false))
  it('localToday formats YYYY-MM-DD in local time', () =>
    expect(localToday(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05'))
})

describe('filterAndSortActions', () => {
  const newer = makeAction('newer', { created_at: '2026-10-20T00:00:00Z' })
  const older = makeAction('older', { created_at: '2026-10-02T00:00:00Z', status: 'in_progress' })
  const overdueOld = makeAction('overdueOld', { created_at: '2026-09-01T00:00:00Z', due_date: '2026-10-01' })
  const overdueNew = makeAction('overdueNew', { created_at: '2026-10-10T00:00:00Z', due_date: '2026-10-15' })
  const doneEarly = makeAction('doneEarly', { status: 'completed', completed_at: '2026-10-05T00:00:00Z', due_date: '2026-01-01' })
  const doneLate = makeAction('doneLate', { status: 'completed', completed_at: '2026-10-18T00:00:00Z' })
  const all = [doneEarly, newer, overdueOld, doneLate, older, overdueNew]

  it('active: overdue first (most overdue first), then created_at desc; excludes completed', () =>
    expect(ids(filterAndSortActions(all, 'active', TODAY))).toEqual(['overdueOld', 'overdueNew', 'newer', 'older']))

  it('active includes both not_started and in_progress', () => {
    const r = filterAndSortActions(all, 'active', TODAY)
    expect(r.map((a) => a.status)).toEqual(expect.arrayContaining(['not_started', 'in_progress']))
  })

  it('completed: completed_at desc', () =>
    expect(ids(filterAndSortActions(all, 'completed', TODAY))).toEqual(['doneLate', 'doneEarly']))

  it('completed: missing completed_at sorts last', () => {
    const noDate = makeAction('noDate', { status: 'completed' })
    expect(ids(filterAndSortActions([noDate, doneEarly], 'completed', TODAY))).toEqual(['doneEarly', 'noDate'])
  })

  it('all: active (overdue at top) then completed', () =>
    expect(ids(filterAndSortActions(all, 'all', TODAY))).toEqual([
      'overdueOld', 'overdueNew', 'newer', 'older', 'doneLate', 'doneEarly',
    ]))

  it('does not mutate the input', () => {
    const input = [...all]
    filterAndSortActions(input, 'all', TODAY)
    expect(input).toEqual(all)
  })
})

describe('empty states per filter tab', () => {
  const active = makeAction('active')
  const done = makeAction('done', { status: 'completed', completed_at: '2026-10-05T00:00:00Z' })

  it('all tab is empty only with no actions', () => {
    expect(filterAndSortActions([], 'all', TODAY)).toHaveLength(0)
    expect(filterAndSortActions([done], 'all', TODAY)).toHaveLength(1)
  })
  it('active tab is empty when everything is completed', () =>
    expect(filterAndSortActions([done], 'active', TODAY)).toHaveLength(0))
  it('completed tab is empty when nothing is completed', () =>
    expect(filterAndSortActions([active], 'completed', TODAY)).toHaveLength(0))
  it('each tab has its own empty message', () => {
    expect(ACTION_EMPTY_MESSAGES.all).toBe("You haven't created any actions yet.")
    expect(ACTION_EMPTY_MESSAGES.active).toBe('No active actions. Add one to start tracking your progress.')
    expect(ACTION_EMPTY_MESSAGES.completed).toBe('No completed actions yet. Mark an action complete to see it here.')
  })
})

describe('formatActualImpact', () => {
  it('usd → currency, no trailing cents', () => expect(formatActualImpact(4200, 'usd')).toBe('$4,200'))
  it('usd with cents shows two digits', () => expect(formatActualImpact(1234.5, 'usd')).toBe('$1,234.50'))
  it('usd negative', () => expect(formatActualImpact(-500, 'usd')).toBe('-$500'))
  it('percent', () => expect(formatActualImpact(12.5, 'percent')).toBe('12.5%'))
  it('months plural', () => expect(formatActualImpact(3, 'months')).toBe('3 months'))
  it('months singular', () => expect(formatActualImpact(1, 'months')).toBe('1 month'))
  it('units plural with grouping', () => expect(formatActualImpact(1200, 'units')).toBe('1,200 units'))
  it('units singular', () => expect(formatActualImpact(1, 'units')).toBe('1 unit'))
  it('no unit → plain number', () => expect(formatActualImpact(42, null)).toBe('42'))
})

// ─── Chunk 2: overdue state ───────────────────────────────────────────────────

describe('overdue detection', () => {
  it('past due + not_started → overdue', () =>
    expect(isOverdue(makeAction('a', { due_date: '2026-10-01', status: 'not_started' }), TODAY)).toBe(true))
  it('past due + in_progress → overdue', () =>
    expect(isOverdue(makeAction('a', { due_date: '2026-10-01', status: 'in_progress' }), TODAY)).toBe(true))
  it('past due + completed → not overdue', () =>
    expect(isOverdue(makeAction('a', { due_date: '2026-10-01', status: 'completed' }), TODAY)).toBe(false))
  it('future due date → not overdue', () =>
    expect(isOverdue(makeAction('a', { due_date: '2026-11-01' }), TODAY)).toBe(false))
  it('no due date → not overdue', () =>
    expect(isOverdue(makeAction('a', { due_date: null }), TODAY)).toBe(false))
  it('countOverdue counts only overdue active actions', () =>
    expect(countOverdue([
      makeAction('a', { due_date: '2026-10-01' }),
      makeAction('b', { due_date: '2026-10-20', status: 'in_progress' }),
      makeAction('c', { due_date: '2026-10-01', status: 'completed' }),
      makeAction('d', { due_date: '2026-12-01' }),
      makeAction('e'),
    ], TODAY)).toBe(2))
})

describe('sort groups', () => {
  // created_at chosen so that created_at order alone would give the wrong answer
  const mostOverdue = makeAction('mostOverdue', { due_date: '2026-09-01', created_at: '2026-08-01T00:00:00Z' })
  const lessOverdue = makeAction('lessOverdue', { due_date: '2026-10-20', created_at: '2026-10-19T00:00:00Z' })
  const futureOld = makeAction('futureOld', { due_date: '2026-12-01', created_at: '2026-09-01T00:00:00Z' })
  const futureNew = makeAction('futureNew', { due_date: '2026-11-01', created_at: '2026-10-15T00:00:00Z' })
  const dueToday = makeAction('dueToday', { due_date: TODAY, created_at: '2026-10-10T00:00:00Z' })
  const noDateNew = makeAction('noDateNew', { created_at: '2026-10-21T00:00:00Z' })
  const noDateOld = makeAction('noDateOld', { created_at: '2026-07-01T00:00:00Z' })
  const done = makeAction('done', { status: 'completed', completed_at: '2026-10-21T00:00:00Z', due_date: '2026-01-01' })
  const shuffled = [noDateNew, done, futureOld, lessOverdue, noDateOld, dueToday, mostOverdue, futureNew]

  it('overdue group: due date ascending (most overdue first)', () =>
    expect(ids(filterAndSortActions(shuffled, 'active', TODAY)).slice(0, 2)).toEqual(['mostOverdue', 'lessOverdue']))

  it('overdue ties on due date fall back to newest created', () => {
    const tieOld = makeAction('tieOld', { due_date: '2026-10-01', created_at: '2026-09-01T00:00:00Z' })
    const tieNew = makeAction('tieNew', { due_date: '2026-10-01', created_at: '2026-09-20T00:00:00Z' })
    expect(ids(filterAndSortActions([tieOld, tieNew], 'active', TODAY))).toEqual(['tieNew', 'tieOld'])
  })

  it('future-dated (incl. due today) sort after overdue, newest created first', () =>
    expect(ids(filterAndSortActions(shuffled, 'active', TODAY)).slice(2, 5)).toEqual(['futureNew', 'dueToday', 'futureOld']))

  it('no-due-date actions sort after future-dated ones, newest created first', () =>
    expect(ids(filterAndSortActions(shuffled, 'active', TODAY)).slice(5)).toEqual(['noDateNew', 'noDateOld']))

  it('all tab: overdue → future-dated → no due date → completed', () =>
    expect(ids(filterAndSortActions(shuffled, 'all', TODAY))).toEqual([
      'mostOverdue', 'lessOverdue', 'futureNew', 'dueToday', 'futureOld', 'noDateNew', 'noDateOld', 'done',
    ]))
})

describe('tab label counts', () => {
  it('active tab shows overdue count when > 0', () => {
    const counts = getTabCounts([
      makeAction('a', { due_date: '2026-10-01' }),
      makeAction('b'),
      makeAction('c', { status: 'in_progress' }),
      makeAction('d', { status: 'completed', completed_at: '2026-10-05T00:00:00Z' }),
    ], TODAY)
    expect(counts.active).toEqual({ count: 3, overdue: 1 })
    expect(counts.all).toEqual({ count: 4, overdue: 0 })
    expect(counts.completed).toEqual({ count: 1, overdue: 0 })
  })

  it('overdue count is 0 (hidden) when nothing is overdue', () =>
    expect(getTabCounts([makeAction('a', { due_date: '2026-12-01' }), makeAction('b')], TODAY).active)
      .toEqual({ count: 2, overdue: 0 }))

  it('completed actions past due never add to the overdue count', () =>
    expect(getTabCounts([makeAction('d', { status: 'completed', due_date: '2026-01-01' })], TODAY).active)
      .toEqual({ count: 0, overdue: 0 }))
})
