# ELIDAN AI — Claude Code Project Context
Last updated: June 2026
@AGENTS.md

# ELIDAN AI — Claude Code Project Context

## Project Overview
Elidan AI is an AI-powered CFO intelligence 
platform for SMBs ($250K–$5M revenue).
Next.js 14, TypeScript, Tailwind, 
Supabase, Stripe, Vercel.

## Brand Tokens
Primary colours:
  Navy:   #0A1A2F  (backgrounds, headings)
  Teal:   #2CA6A4  (CTAs, active states, AI)
  White:  #F4F7FA  (page background)
  Slate:  #344150  (body text)
  Gold:   #D4AF7F  (once per screen max)
  Border: #D8E2EC  (all borders)
  Muted:  #6B7A8D  (placeholder, sub-labels)

Semantic colours:
  Danger:  #E84545
  Warning: #F59E0B
  Success: #22C55E
  Surface: #FFFFFF (card backgrounds)

Typography:
  Font: Inter (weights 300/400/500 ONLY)
  Never use weight 600+ in UI components

Spacing: 8px grid system
Border radius: 16px cards, 10px buttons
Shadow: 0 1px 3px rgba(10,26,47,0.08)

## File Structure
lib/calculations.ts    — pure calculation functions
lib/types.ts           — TypeScript interfaces
lib/db.ts              — database queries
lib/featureGates.ts    — feature gate logic
lib/stripe.ts          — Stripe client
lib/excelParser.ts     — Excel parsing
lib/usageGate.ts       — usage tracking
lib/launchConfig.ts    — launch config/flags
app/components/        — UI components
app/dashboard/         — dashboard pages
app/api/               — API routes
__tests__/             — test files
docs/                  — documentation

## Standing Rules
ALWAYS:
- Use CSS variables for colours
- Inter 300/400/500 only
- Empty states instead of hiding components
- Keep calculations in lib/calculations.ts
- Keep DB calls in lib/db.ts or API routes
- Use Lucide React for all icons
- Test against Scenario A and C minimum
- Validate numbers before committing

NEVER:
- Hide a component — show empty state
- Hardcode financial data in components
- Use Gold more than once per screen
- Make DB calls inside React components
- Use font weights above 500
- Commit without running npm test

## Component Patterns
Reference: docs/component-patterns.md

Card wrapper:
  background: #FFFFFF
  border: 1px solid #D8E2EC
  border-radius: 16px
  box-shadow: 0 1px 3px rgba(10,26,47,0.08)
  padding: 24px

Stat cards:
  Overline: 10px, weight 500, uppercase
  Value: 32px, weight 500
  Sub-label: 13px, weight 400

Alert colours:
  danger:  border #E84545, bg rgba(232,69,69,0.06)
  warning: border #F59E0B, bg rgba(245,158,11,0.06)
  success: border #2CA6A4, bg rgba(44,166,164,0.06)

## Pricing Tiers
Starter:          $49/mo — dashboard only
Core:             $99/mo — AI features + QB sync
Growth:           $199/mo — unlimited AI + forecast
Advisory:         $499/mo — human CFO layer
Founding Member:  $49/mo — Core forever (first 50)

## Test Accounts
ray@elidan.ai          — superuser, Advisory tier
rayandumasia@gmail.com — test user, switch tiers

## Tier Switch SQL
UPDATE subscriptions
SET plan='core', feature_tier='core'
WHERE user_id=(
  SELECT id FROM auth.users
  WHERE email='rayandumasia@gmail.com'
);

## Commit Conventions
feat:     new feature
fix:      bug fix
test:     test validation
docs:     documentation
refactor: no behaviour change
style:    UI/visual only

## Key Decisions
- Xero and QuickBooks both at Core tier
- Bank sync (Plaid) deferred to Phase 4
- Founding Member = Core forever at $49
- Cancel → CS handles manually (no automated grace)
- Growth/Advisory hidden (coming soon)
- Scenarios page hidden pending UX review
- usage_tracking uses 'usage_limit' not 'limit'
- Stripe: one subscription per user enforced