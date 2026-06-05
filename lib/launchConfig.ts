/**
 * FOUNDING MEMBER POLICY (confirmed May 2026)
 *
 * First 50 subscribers receive:
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
 * Spots do NOT return to pool (hard cap: 50 total issued).
 * Do not add expiry logic without explicit approval from the founder.
 */
export const FOUNDING_MEMBER_SPOTS = 50;

/**
 * Tier availability gates — set to true when the tier's features are built and ready to ship.
 * Controls upgrade CTA visibility across PlanComparisonCard and UpgradeModal.
 * Does NOT affect existing subscribers on those tiers.
 */
export const GROWTH_AVAILABLE = false;
export const ADVISORY_AVAILABLE = false;
