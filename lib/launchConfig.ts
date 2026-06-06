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
 * Restoration: handled manually via customer service.
 * Customer emails hello@elidan.ai within 30 days of billing_period_end.
 * We restore manually in Supabase + Stripe.
 *
 * Manual restoration SQL:
 * UPDATE subscriptions
 * SET plan='founding_member', feature_tier='core', status='active', cancelled_at=NULL
 * WHERE user_id=(SELECT id FROM auth.users WHERE email='customer@email.com');
 * Then reactivate in Stripe dashboard.
 *
 * Grace period columns (founding_member_grace_ends_at, fm_grace_warning_sent,
 * fm_grace_expired_email_sent) are retained in the DB schema but no longer populated.
 *
 * Spots do NOT return to pool (hard cap: 25 total issued).
 * Do not add expiry logic without explicit approval from the founder.
 */
export const FOUNDING_MEMBER_SPOTS = 25;

/**
 * Tier availability gates — set to true when the tier's features are built and ready to ship.
 * Controls upgrade CTA visibility across PlanComparisonCard and UpgradeModal.
 * Does NOT affect existing subscribers on those tiers.
 */
export const GROWTH_AVAILABLE = false;
export const ADVISORY_AVAILABLE = false;

// SCENARIOS — Phase 2 vision
//
// Phase 1 (now): Simple What-If calculator
//   on dashboard. Single variable adjustment.
//   No AI, no saved scenarios.
//
// Phase 2 scope:
//   - Variable adjustment (Type 1)
//   - Event modelling (Type 2)
//   - Goal seeking with AI (Type 3)
//   - Saved + named scenarios
//   - Side-by-side comparison (up to 3)
//   - Scenario sharing via link
//   - Ask CFO integration for narrative
//   - Promote to /dashboard/scenarios page
//
// The current What-If card is a placeholder
// for this vision. Keep it simple until
// Phase 2 engineering begins.

const COMING_SOON_FEATURES = new Set(["cfo_call", "ai_insights"]);
export function isFeatureComingSoon(feature: string): boolean {
  return COMING_SOON_FEATURES.has(feature);
}
