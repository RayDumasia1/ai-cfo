export type Feature =
  | 'ask_cfo'
  | 'ai_insights'
  | 'weekly_summary'
  | 'quickbooks_sync'
  | 'xero_sync'
  | 'bank_sync'
  | 'forecasting'
  | 'scenario_comparison'
  | 'action_prefill'
  | 'action_recommendations'
  | 'action_tracker_v3'
  | 'team_seats'
  | 'cfo_call'
  | 'custom_reports'

export type FeatureTier = 'starter' | 'core' | 'growth' | 'advisory' | 'suspended'

export type Plan = 'starter' | 'core' | 'growth' | 'advisory' | 'founding_member'

const FEATURE_TIERS: Record<Feature, FeatureTier> = {
  ask_cfo:                'core',
  ai_insights:            'core',
  weekly_summary:         'starter',   // moved from 'core' — all tiers receive weekly CFO email
  quickbooks_sync:        'core',
  xero_sync:              'core',
  bank_sync:              'advisory',  // Phase 4 — deferred
  forecasting:            'growth',
  scenario_comparison:    'growth',
  action_prefill:         'core',      // V2 smart pre-fill from insights
  action_recommendations: 'growth',    // V2 AI engine: recommended actions, batch, impact tracking, WYSD widget
  action_tracker_v3:      'advisory',
  team_seats:             'advisory',
  cfo_call:               'advisory',
  custom_reports:         'advisory',
}

export const TIER_RANK: Record<FeatureTier, number> = {
  suspended: -1,
  starter: 0,
  core: 1,
  growth: 2,
  advisory: 3,
}

export function isSuperuser(email: string): boolean {
  if (process.env.NODE_ENV !== 'development') return false
  const supers = (process.env.SUPERUSER_EMAILS || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
  return supers.includes(email.toLowerCase())
}

export function hasFeature(
  userTier: FeatureTier,
  feature: Feature,
  email?: string
): boolean {
  if (email && isSuperuser(email)) return true
  return TIER_RANK[userTier] >= TIER_RANK[FEATURE_TIERS[feature]]
}

export const USAGE_LIMITS: Record<FeatureTier, Record<string, number | null>> = {
  suspended: {
    ask_cfo_questions: 0,
    ai_insight_runs: 0,
    actions_active: 0,
  },
  starter: {
    ask_cfo_questions: 0,
    ai_insight_runs: 0,
    actions_active: 10,
  },
  core: {
    ask_cfo_questions: 20,
    ai_insight_runs: 3,
    actions_active: 50,
  },
  growth: {
    ask_cfo_questions: 150,
    ai_insight_runs: null,
    actions_active: null,
  },
  advisory: {
    ask_cfo_questions: null,
    ai_insight_runs: null,
    actions_active: null,
  },
}

export const UPGRADE_MESSAGES: Record<
  Feature,
  { title: string; message: string; upgrade_to: FeatureTier }
> = {
  ask_cfo: {
    title: 'Ask your CFO a question',
    message: 'Get AI-powered answers to your financial questions — upgrade to Core from $99/month',
    upgrade_to: 'core',
  },
  ai_insights: {
    title: 'AI-powered insights',
    message: 'Get AI insights on your finances — upgrade to Core from $99/month',
    upgrade_to: 'core',
  },
  weekly_summary: {
    title: 'Weekly CFO summary',
    message: 'Your weekly CFO email summary is included with every plan',
    upgrade_to: 'starter',
  },
  quickbooks_sync: {
    title: 'Connect your accounting system',
    message: 'Connect QuickBooks or Xero for automatic daily sync — upgrade to Core from $99/month',
    upgrade_to: 'core',
  },
  xero_sync: {
    title: 'Connect your accounting system',
    message: 'Connect QuickBooks or Xero for automatic daily sync — upgrade to Core from $99/month',
    upgrade_to: 'core',
  },
  forecasting: {
    title: '12-month cash flow forecast',
    message: 'See where your cash is heading — upgrade to Growth from $199/month',
    upgrade_to: 'growth',
  },
  scenario_comparison: {
    title: 'Scenario comparison',
    message: 'Compare multiple financial scenarios side by side — upgrade to Growth from $199/month',
    upgrade_to: 'growth',
  },
  action_prefill: {
    title: 'AI action pre-fill',
    message: 'Let AI pre-fill actions from your insights — upgrade to Core from $99/month',
    upgrade_to: 'core',
  },
  action_recommendations: {
    title: 'AI-recommended actions',
    message: 'Let AI recommend your next financial actions — available on Growth from $199/month',
    upgrade_to: 'growth',
  },
  action_tracker_v3: {
    title: 'Team action management',
    message: 'Assign actions to team members — upgrade to Advisory from $599/month',
    upgrade_to: 'advisory',
  },
  team_seats: {
    title: 'Team seats',
    message: 'Add team members to your account — upgrade to Advisory from $599/month',
    upgrade_to: 'advisory',
  },
  cfo_call: {
    title: 'Monthly CFO call',
    message: 'Book a monthly 60-minute CFO strategy call — upgrade to Advisory from $599/month',
    upgrade_to: 'advisory',
  },
  custom_reports: {
    title: 'Custom reports',
    message: 'Board-ready financial reports — upgrade to Advisory from $599/month',
    upgrade_to: 'advisory',
  },
  bank_sync: {
    title: 'Bank account sync',
    message: 'Direct bank account sync — coming in a future update',
    upgrade_to: 'advisory',
  },
}
