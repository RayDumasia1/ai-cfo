/**
 * FOUNDING MEMBER POLICY (confirmed May 2026)
 *
 * First 25 subscribers receive:
 * - Core features at $49/month
 * - Rate locked permanently (never increases)
 * - No expiry on Core features — benefits are indefinite while subscribed
 * - Founding Member badge forever
 *
 * CANCELLATION POLICY (updated — simplified)
 *
 * Cancel → Core active until billing_period_end
 * After billing_period_end → account suspended (feature_tier: 'suspended')
 *
 * Confirmed October 2026: self-service reinstatement in account settings is
 * available only before the current paid billing cycle ends. It clears the
 * scheduled cancellation on the existing Stripe subscription and keeps $49/Core.
 * After the subscription ends, contact support for manual, case-by-case review;
 * reinstatement and the Founding rate are not guaranteed. There is no 30-day
 * self-service grace period or automatic permanent forfeiture rule.
 * A former member may instead subscribe fresh at standard plan pricing.
 * Member numbers and badges are permanent, regardless of current plan/status.
 * Support-approved checkout must carry Stripe session metadata
 * founding_reinstatement=support plus supabase_user_id and plan_key=founding_member.
 * Never accept that approval from a public API request. The old Stripe
 * subscription must be terminal; reinstatement reuses the original member number.
 *
 * Customer spots #1-#25 do NOT return on cancellation. Explicit database-owner
 * corrections (such as reclaiming a test assignment) are audited exceptions.
 * Designated test memberships use #26 onward, are excluded from capacity and
 * allocation, and can be cleared or reassigned by the administrator.
 * Corrections change identity only, never Stripe billing or feature access.
 * See foundingMemberState.ts and the permanent founding_member_spots registry.
 */
// Also drives the public marketing counter (GET /api/public/founding-spots)
// via lib/foundingMembers.ts — the only place the cap should be read from.
export const FOUNDING_MEMBER_SPOTS = 25;

/**
 * Tier availability gates — set to true when the tier's features are built and ready to ship.
 * Controls upgrade CTA visibility across PlanComparisonCard and UpgradeModal.
 * Does NOT affect existing subscribers on those tiers.
 */
export const GROWTH_AVAILABLE = false;
export const ADVISORY_AVAILABLE = false;

// SCENARIOS — approved product allocation (FIN-03C)
//
// Starter: one unsaved scenario based on the customer's current financial
// baseline. It supports recurring collections/spending adjustments and clearly
// separated one-time cash receipts/payments, with baseline-versus-scenario
// results. No AI and no database persistence.
//
// Higher-tier follow-on scope:
//   - Saved + named scenarios
//   - Side-by-side comparison (up to 3)
//   - Event timelines and richer operating drivers
//   - Goal seeking and narrative guidance with AI
//   - Scenario sharing and CFO/advisor collaboration
//   - Dedicated /dashboard/scenarios workflow
//
// The existing three-field What-If card remains a placeholder until FIN-03C2.

const COMING_SOON_FEATURES = new Set([
  "cfo_call",
  "ai_insights",
  "tier_core",
  "tier_growth",
  "tier_advisory",
]);
export function isFeatureComingSoon(feature: string): boolean {
  return COMING_SOON_FEATURES.has(feature);
}
