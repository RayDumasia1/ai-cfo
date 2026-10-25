# Elidan AI — UI Component Patterns & Design System
**Version 1.2 · June 2026 · Internal**

Delivery status, remaining fixes and agreed future work: [Application backlog](backlog.md).

Approved financial definitions and worked examples: [Financial metric contract v0.2](financial-metric-contract.md). FIN-01 establishes product direction. FIN-02 implements the legacy-schema compatibility model; DATA-01 and FIN-03 remain future increments.

FIN-02 treats legacy `total_revenue` as reported cash collected and `total_expenses` as reported cash paid in customer-facing copy. `legacyCashHealth()` is the shared dashboard calculation: it accepts only the newest uninterrupted run of up to three months, stops at a gap or blank required value, separates reported spending coverage from estimated net-cash runway, and returns no runway for break-even or cash-generating activity. Current runway alerts require three eligible months and stop after 90 days; historical data does not produce a current depletion date. The manual calculator uses the same definitions. No database migration accompanies FIN-02.

The default owner dashboard translates those definitions into Cash Balance, Cash Buffer, Cash Trend and Cash Runway. Supporting copy explains the practical meaning and states when an update is required. Professional terminology belongs in methodology/detail views rather than the owner summary. A zero-alert result is not automatically healthy: use `financialDataFreshness()` so current, stale, historical and missing data receive different empty-state guidance.

Cash Balance accents are freshness-aware. Current data may use the saved minimum-reserve comparison, 46–90-day data uses a warning accent, and data older than 90 days uses a neutral accent. A historical balance must not inherit a green healthy-state treatment.

DATA-01 contract v2 is specified in [financial-data-contract-v2.md](financial-data-contract-v2.md). Schema evolution is additive: never copy ambiguous legacy revenue/expense values into classified cash-flow fields. Keep legacy writers on contract version 1 until the v2 parser and reviewed-import transaction publish every required field atomically. Revision snapshots use full monthly-row JSON and therefore preserve new columns automatically.

---

## 01 Brand Tokens

All design values are defined once here. Never hardcode a colour, size, or spacing value — always use the token.

### 1.1 Colour Palette

| Token | Value | Usage |
|---|---|---|
| `--navy` | `#0A1A2F` | Sidebar, nav, hero backgrounds, headings |
| `--slate` | `#344150` | Body text, subheadings, mid-tone elements |
| `--teal` | `#2CA6A4` | CTAs, active states, links, AI indicators, success |
| `--teal-light` | `#3DBFBD` | Hover state for teal interactive elements |
| `--teal-dark` | `#1E7B79` | Pressed state, dark teal text on light backgrounds |
| `--white` | `#F4F7FA` | Page background — Cloud White, not pure white |
| `--surface` | `#FFFFFF` | Card backgrounds, input fields, modals |
| `--gold` | `#D4AF7F` | Premium signal only. **Once per screen maximum.** |
| `--border` | `#D8E2EC` | All borders, dividers, table lines |
| `--muted` | `#6B7A8D` | Placeholder text, sub-labels, secondary info |
| `--danger` | `#E84545` | Error states, danger alerts, critical indicators |
| `--warning` | `#F59E0B` | Warning alerts, amber runway indicator |
| `--success` | `#22C55E` | Positive variance, completed states |

### 1.2 Typography

| Scale | Value | Usage |
|---|---|---|
| Font family | Inter (Google Fonts) | Weights 300/400/500 ONLY. Never 600+ in UI. |
| Display | 48px / weight 500 | Hero headlines, major stat values |
| H1 | 36px / weight 500 | Page titles. Letter-spacing: -1px |
| H2 | 28px / weight 500 | Section titles. Letter-spacing: -0.5px |
| H3 | 22px / weight 500 | Subsection titles |
| H4 | 17px / weight 500 | Card titles, sidebar labels |
| Body | 14px / weight 400 | Standard body text. Line-height: 1.6 |
| Caption | 12px / weight 500 | Sub-labels, stat card meta |
| Overline | 11px / weight 500 | Section labels. Uppercase. Letter-spacing: 0.14em |
| Monospace | 13px / Courier New | Financial values in tables |

### 1.3 Spacing (8px grid)

| Token | Value | Usage |
|---|---|---|
| `--space-1` | 4px | Icon padding, tight gaps |
| `--space-2` | 8px | Between icon and label |
| `--space-3` | 12px | Button padding, form field gap |
| `--space-4` | 16px | Card padding (small) |
| `--space-5` | 24px | Card padding (standard) |
| `--space-6` | 32px | Between cards in grid |
| `--space-8` | 48px | Page horizontal padding |
| `--space-12` | 80px | Major section breaks |

### 1.4 Border Radius

| Token | Value | Usage |
|---|---|---|
| `--radius-sm` | 6px | Badges, tags, chips |
| `--radius-md` | 10px | Buttons, inputs, alerts |
| `--radius-lg` | 16px | Cards, panels, modals |
| `--radius-xl` | 24px | Hero cards, large feature blocks |

### 1.5 Shadows

| Token | Value | Usage |
|---|---|---|
| `--shadow-sm` | `0 1px 3px rgba(10,26,47,0.08)` | Cards, form fields |
| `--shadow-md` | `0 4px 16px rgba(10,26,47,0.10)` | Elevated cards, CTAs |
| `--shadow-lg` | `0 8px 32px rgba(10,26,47,0.12)` | Modals, dropdowns |

---

## 02 Empty State Pattern (Standing Rule)

> **STANDING RULE: Never hide a component because it has no data. Always render the component shell with a meaningful empty state.**

| Component | Has Data | No Data | Rule |
|---|---|---|---|
| Stat Cards | Real value with colour indicators | Show `—`, show "Import data to calculate" | Never hide. `—` always visible. |
| Chart Components | Full chart | Card shell + icon + message + action link | Maintain same height. Never collapse. |
| Alerts Panel | Alerts sorted by severity | "✓ Everything looks healthy" | Never hide panel. |
| Tables & Lists | Data rows | Icon + "No [items] yet" | Same dimensions maintained. |
| AI Insights | Insight cards | "Insights will appear after data import" | Never hide section. |
| Action List | Action rows | "No actions yet. Create one to get started." | Empty state is the CTA. |

### Chart Empty State Specification

```
Card at full size (same border, shadow, radius)
Title: "[Chart Name] · No data yet"
Min height: 200px
Centred content:
  - Lucide icon 32px, colour #D8E2EC
  - One-line description, 13px, #6B7A8D, max-width 280px
  - Teal link "Upload data →", 13px, #2CA6A4
```

### Stat Card Empty State

```
Value: — (em dash), colour #6B7A8D
Sub-label: "Import data to calculate", 12px, #6B7A8D
Border: neutral 1px solid #D8E2EC (no colour border)
```

### Empty State Icons

| Component | Icon (Lucide) |
|---|---|
| Revenue vs Burn chart | BarChart2 |
| Alerts panel | Bell |
| Cash flow forecast | TrendingUp |
| Ask CFO | MessageSquare |
| AI Insights | Sparkles |
| Action list | CheckSquare |

---

## 03 Core Component Patterns

### 3.1 Card Wrapper

All surface cards use this exact wrapper:

```css
background:    #FFFFFF
border:        1px solid #D8E2EC
border-radius: 16px
box-shadow:    0 1px 3px rgba(10,26,47,0.08)
padding:       24px
```

### 3.2 Stat Cards

**Structure (top to bottom):**
- Overline label: 10px, weight 500, uppercase, letter-spacing 0.14em, `#6B7A8D`
- Value: 32px, weight 500, letter-spacing -1px, `#0A1A2F`
- Sub-label: 13px, weight 400, with trend indicator

**Left border colour rules:**
- No data: no colour border — `1px solid #D8E2EC` only
- Runway > warning threshold: `3px solid #22C55E` (green)
- Runway between danger/warning: `3px solid #F59E0B` (amber)
- Runway < danger threshold: `3px solid #E84545` (red)
- Cash below reserve: `3px solid #E84545` (red)

**Trend indicators:**
- `↑ X%` in teal if positive for metric
- `↓ X%` in red if negative for metric
- Note: burn rate increase = negative (red ↑). Revenue increase = positive (teal ↑).

### 3.3 Alert Components

**Severity colours:**
- `danger`: border `#E84545`, bg `rgba(232,69,69,0.06)`, icon ✕
- `warning`: border `#F59E0B`, bg `rgba(245,158,11,0.06)`, icon ⚠
- `success`: border `#2CA6A4`, bg `rgba(44,166,164,0.06)`, icon ✓
- `info`: border `#2CA6A4`, bg `rgba(44,166,164,0.06)`, icon ◈

**Alert structure:**
- Left border: 3px solid severity colour
- Border radius: 10px
- Padding: 14px 16px
- Title: 13px, weight 600, severity colour
- Message: 13px, weight 400, `#344150`
- Action link (optional): 12px, teal, right-aligned
- Sort order: danger → warning → success → info

**Dismiss behaviour:**
- `danger` alerts (RUNWAY_DANGER, CASH_BELOW_RESERVE): no X button, cannot be dismissed
- `warning` and `success`: X button visible, dismissible with snooze
- Snooze options: `data_reload` | `24h` | `7d` (set in Settings)
- Confirmed UI: alert stays visible with a disabled/spinning dismissal control until the API confirms success; failures leave it visible with accessible feedback
- `data_reload` snooze: alert reappears when user imports new data (data_version changes)

**Alert panel layout:**
- Top position (above stat cards): danger + warning only
- Bottom position (below chart): success + info only
- Top panel collapsible with count badge: "Alerts [2]"
- Collapse state persists in localStorage: `elidan_alerts_collapsed`
- Resets to expanded when new data is imported

### 3.4 Sidebar Navigation

```
Container:
  background: #0A1A2F
  width: 220px fixed
  border-right: 1px solid rgba(44,166,164,0.2)

Nav items:
  default:  13px, #8FA3B8
  hover:    #F4F7FA, bg rgba(255,255,255,0.05)
  active:   #2CA6A4, bg rgba(44,166,164,0.10), 
            left border 2px solid #2CA6A4
  
Current nav items (in order):
  Dashboard   → /dashboard
  [Scenarios] → hidden pending UX review
  Settings    → /dashboard/settings
  Reports     → hidden (Advisory only, not built)
```

Active state detection: `usePathname()` — exact match for `/dashboard`, prefix match for all other routes.

### 3.5 Buttons

**Primary:**
```css
background: #2CA6A4
color: white, 14px, weight 500
border: 1.5px solid #2CA6A4
border-radius: 10px
hover: background #3DBFBD
disabled: opacity 0.5, cursor not-allowed
```

**Secondary:**
```css
background: transparent
color: #0A1A2F, 14px, weight 500
border: 1.5px solid #0A1A2F
hover: background #0A1A2F, color white
```

**Ghost/text:**
```css
background: transparent
color: #2CA6A4, 14px, weight 400
border: none
hover: color #1E7B79, underline
```

**Danger:**
```css
background: #E84545
color: white, 14px, weight 500
border: 1.5px solid #E84545
hover: background #CC3030
Use ONLY for destructive actions
```

---

## 04 Settings Page Patterns

### 4.1 Settings Tab Navigation

Settings page has three tabs driven by `?tab=` query param:
- `general` (default): Alert Preferences, Financial Thresholds
- `billing`: Billing page (plan, usage, comparison, CFO call)
- `account`: Account card, Change Password card

Tab styling:
```
Tab row: border-bottom 1px solid #D8E2EC
Active tab: colour #2CA6A4, border-bottom 2px solid #2CA6A4
Default tab: colour #6B7A8D
```

### 4.2 ThresholdsCard — Saved/Previous Value Pattern

Three-state indicator per field:

**State 1 — Clean** (current === saved):
- No indicator, input full width

**State 2 — Dirty** (current ≠ saved):
- Input gets teal focus ring: `border: 1.5px solid #2CA6A4`, `box-shadow: 0 0 0 3px rgba(44,166,164,0.12)`
- "Saved: X ↺" appears inline right of input
- Reset icon (RotateCcw, 11px) resets field to saved value (does NOT save to DB)
- "N unsaved changes" count appears next to Save button

**State 3 — Just saved** (current === saved, previousValues[field] exists):
- "Previous: X ↺" appears inline right of input
- Session-only — clears on page reload
- Reset icon requests a restore of the previous value; indicators/history change only after API confirmation
- A failed restore retains the current draft, confirmed baseline, and previous-value history for retry

Value formatting:
- Threshold fields: plain number "Saved: 6"
- Cash reserve: currency "Saved: $25,000"
- Burn rate: percentage "Saved: 10%"
- Fractional percentages are retained (for example 10.5%); blank cash reserve is unset, distinct from explicit zero

### 4.3 AlertPreferencesCard

Snooze duration radio group:
- Options: `data_reload` | `24h` (default) | `7d`
- Stored in Supabase `business_profiles.snooze_duration`
- Server preference is authoritative; unscoped legacy localStorage values are never migrated into the signed-in account
- "Danger alerts cannot be snoozed" helper text always visible

### 4.4 ChangePasswordCard

Position: between AlertPreferencesCard and AccountCard.
- Current password, new password, confirm new password
- Show/hide toggle (Eye/EyeOff) on each field
- `aria-label` updates: "Show password" / "Hide password"
- Client-side validation: min 8 chars, passwords match
- Server-side: validates body/password types, re-authenticates the signed-in account with the current password, and checks returned identity before updating
- Success: "Password updated ✓", fields cleared, fades after 3s

---

## 05 Billing Component Patterns

### 5.1 UpgradeModal

Triggered when a user hits a feature gate or clicks an upgrade CTA.

```
Overlay: rgba(10,26,47,0.6), backdrop-blur(4px)
Modal: white, 480px max-width, 90vw, border-radius 16px
       padding 32px, shadow-lg
```

**Content structure:**
1. Close button (X, top-right, absolute)
2. Teal icon circle (56px, bg rgba(44,166,164,0.12))
3. Feature title (20px, weight 500, centred)
4. Message (14px, #6B7A8D, centred)
5. Tier comparison strip (current → required)
6. Feature highlights (3 bullets, CheckCircle2 14px teal)
7. CTA button "Upgrade to [Tier]" or "Coming Soon" state
8. "Maybe later" link

**Coming Soon state** (when `isFeatureComingSoon(feature)` returns true):
- Replace CTA with "Coming Soon" badge + notify me email input
- POST to `/api/notify-me` → sends email to hello@elidan.ai
- Show "You'll be notified ✓" on success

**Escape key + click outside = close modal.**

### 5.2 UpgradeStrip

Slim banner shown at bottom of dashboard for Starter users.

```
background: rgba(44,166,164,0.06)
border: 1px solid rgba(44,166,164,0.20)
border-left: 3px solid #2CA6A4
border-radius: 10px
padding: 14px 20px
```

Content:
- If Founding Member spots available: "✦ Founding Member spots available — Core features at $49/month. [N] spots remaining." → "Become a Founding Member →"
- If sold out: "Upgrade to Core to unlock AI Insights, Ask your CFO, and more" → "View plans →"

Hidden for Core and above.

### 5.3 FoundingMemberBadge

```
Gold pill: "✦ Founding Member #[n]"
background: #FBF5EC
border: 1px solid #D4AF7F
border-radius: 6px
padding: 4px 10px
font: 12px, weight 500, #7D4E00
```

Sub-text below badge:
- Active: "Core features · Locked forever" (12px, #6B7A8D)
- Suspended: "Account suspended" (12px, #F59E0B)

### 5.4 PendingCancellationBanner

Shown on dashboard when `status === 'pending_cancellation'`.

```
Amber styling:
background: rgba(245,158,11,0.08)
border: 1px solid rgba(245,158,11,0.30)
border-left: 3px solid #F59E0B
border-radius: 10px
padding: 14px 20px
```

Content:
- "Your subscription is cancelled — access continues until [date]. Changed your mind?"
- "Undo cancellation →" button → calls `/api/stripe/reactivate`

### 5.5 Suspended State

When `feature_tier === 'suspended'` or `status === 'cancelled'` and billing ended:

Simple full-page message replacing dashboard content:
```
Title: "Your subscription has ended"
Sub-text: "Contact us at hello@elidan.ai to restore 
  your Founding Member access or subscribe to a new plan."
Button 1: "Email us" → mailto:hello@elidan.ai (navy)
Button 2: "View plans" → /dashboard/settings?tab=billing (teal)
```

No countdown timers. No automated restore. Manual CS process.

### 5.6 FoundingMemberCTA

Dark navy/gold card shown on Billing tab for Starter users.

```
background: linear-gradient(135deg, #0A1A2F 0%, #1A2E44 100%)
border: 1px solid #D4AF7F
border-radius: 16px
padding: 24px
```

CTA button: gold background `#D4AF7F`, navy text, 44px height.

Sold out state: neutral card with "Join the waitlist" secondary button.

### 5.7 Plan Badge Colours

| Plan | Border | Background | Text | Label |
|---|---|---|---|---|
| starter | `#D4AF7F` | `#FBF5EC` | `#7D4E00` | Starter |
| core | `#2CA6A4` | `#E8F7F7` | `#1A6B69` | Core |
| growth | `#6366F1` | `#EEEDFE` | `#3C3489` | Growth |
| advisory | `#0A1A2F` | `#E8ECF0` | `#0A1A2F` | Advisory |
| founding_member | `#D4AF7F` | `#FBF5EC` | `#7D4E00` | Founding Member |

---

## 06 Launch Configuration

`lib/launchConfig.ts` controls what's visible at launch. When a feature is ready, remove it from `coming_soon_features` and it automatically appears everywhere.

**Currently live:**
- Dashboard, alerts, Excel import, settings, billing, What-If scenario

**Coming soon (hidden from users):**
- `ask_cfo`, `ai_insights`, `weekly_summary`, `quickbooks_sync`
- `forecasting`, `scenario_comparison`, `action_tracker_v2`, `action_tracker_v3`
- `team_seats`, `cfo_call`, `custom_reports`, `bank_sync`

**Hidden from nav:**
- Scenarios page: hidden pending UX review
- Reports: Advisory only, not yet built

---

## 07 Soft Gold — Usage Rules

> Gold (`#D4AF7F`) is a premium signal. **Maximum once per screen composition.**

**Approved uses:**
- Rising Column logo mark diagonal line
- Founding Member badge and CTA
- Premium tier indicators
- Single decorative accent on CTA section

**Prohibited:**
- Gold as background fill
- Gold as body text
- More than one gold element per screen
- Gold for standard UI chrome

---

## 08 Standing Rules for Claude Code

### Always
- Use CSS variables for colours — never hardcode hex values
- Use Inter weights 300/400/500 only — never 600+ in UI
- Render empty states — never hide components
- Keep calculations in `lib/calculations.ts`
- Keep DB calls in `lib/db.ts` or API routes
- Use Lucide React for all icons
- Respect `prefers-reduced-motion`
- Test against Scenario A and Scenario C minimum
- Run `npm test` before committing
- Follow card wrapper pattern (Section 3.1)
- Check `lib/launchConfig.ts` before building new feature UI

### Never
- Hide a component — always show empty state
- Hardcode financial data in components
- Use Gold more than once per screen
- Make DB calls inside React components
- Use font weights above 500
- Add calculation logic to presentation components
- Trust `business_id` from client — always derive server-side
- Use `limit` as a column name in PostgreSQL (reserved word — use `usage_limit`)

### File Structure

```
lib/calculations.ts    — pure calculation functions
lib/types.ts           — TypeScript interfaces
lib/db.ts              — database queries
lib/featureGates.ts    — feature gate logic
lib/usageGate.ts       — usage tracking middleware
lib/stripe.ts          — Stripe client and price map
lib/excelParser.ts     — Excel/CSV parsing
lib/launchConfig.ts    — launch feature flags
lib/apiGate.ts         — checkFeatureGate helper
app/components/        — reusable UI components
app/components/billing/— billing-specific components
app/dashboard/         — dashboard pages
app/api/               — API routes
app/api/stripe/        — Stripe checkout, webhook, portal, reactivate
app/api/cron/          — scheduled jobs
__tests__/             — test files
__tests__/fixtures/    — test data (Excel template)
public/downloads/      — user-downloadable files
docs/                  — project documentation
```

### Commit Conventions

```
feat:     new feature or component
fix:      bug fix
test:     test validation or test data
docs:     documentation updates
refactor: no behaviour change
style:    UI/visual changes only
```

---

## 09 Key Architectural Decisions

| Decision | Rule |
|---|---|
| Accounting integrations | QuickBooks only at launch (Core) — Xero and others deferred |
| Bank sync | Deferred to Phase 4 |
| Founding Member | Core forever at $49, no 24-month expiry |
| FM cancellation | Core access through paid billing end; self-service reinstatement in account settings before that cutoff. Afterward, support reviews reinstatement case by case. Standard plans remain available; number/badge stay permanent and issued spots never return to the pool. |
| FM spots | Customer numbers #1-#25 stay consumed after cancellation. Audited database-owner corrections may release mistaken/test assignments. Explicit test memberships use #26 onward and do not affect customer capacity. |
| Suspended state | Simple message + email us — no automated restore |
| Scenarios page | Hidden pending UX review |
| Growth/Advisory | Hidden — coming soon |
| `usage_limit` | Not `limit` — PostgreSQL reserved word |
| One subscription per user | Enforced — updates not new checkouts |
| feature_tier vs plan | Decoupled — feature access independent of billing price |
| `business_id` | Always derived server-side, never trusted from client |
| Email verification | Protected application APIs require a validated Auth user with `email_confirmed_at`; return 403 `EMAIL_NOT_VERIFIED` before data or billing work. Verification is separate from paid-subscription and feature checks. |
| Stripe webhooks | Verify signatures; acknowledge processed/irrelevant events with 200, reject invalid signatures with 400, and return 500 for state-processing failures so Stripe can retry. Normalize statuses before database writes. |
| Service role client | Only in webhooks, cron jobs, admin routes |

---

### Authentication and email verification

Protected application APIs require a valid Supabase session **and** a confirmed email. The shared policy in `lib/authPolicy.ts` checks `email_confirmed_at` on the user returned by `supabase.auth.getUser()`. Request fields, phone confirmation, and editable `user_metadata.email_verified` do not establish email verification.

| Condition | Application response |
|---|---|
| Missing/invalid session | Protected handlers return 401. Authentication errors are rejected even if a user object was also returned. |
| Authenticated user without confirmed email | Protected APIs return 403 with code `EMAIL_NOT_VERIFIED` and `Cache-Control: no-store`; protected page requests redirect to `/auth/verify`. |
| Verified user without an eligible paid subscription | Existing subscription guard returns 402 for protected APIs or redirects pages to `/welcome`. Verified users can still choose a plan and reach billing flows. |
| Verified user with eligible subscription | Existing feature-tier, usage-limit, and account-scoping checks continue to apply. |

Proxy no longer passes all API calls through for an unverified session before checking subscription eligibility. `requireAuth` also enforces email verification at the handler boundary. Import, billing portal, and invoice routes perform the same check before parsing files, accessing financial/billing records, or calling Stripe, so they do not rely solely on Proxy coverage. Identity comes from the authenticated user rather than any client-supplied account ID.

Email-verification, signup, callback, and password-reset pages remain reachable. The exact `/api/auth/login` and `/api/auth/logout` paths remain usable before email verification; this exception does not grant a general `/api/auth/*` bypass. The exact `/api/notify-me` path is exempt from the paid-subscription check so verified users choosing a plan or returning after cancellation can register interest. It does not bypass the existing email-verification check or exempt similarly named paths. Public `/api/public/*` endpoints retain their existing access rules. The exact Stripe webhook path bypasses session lookup and authenticates independently using its raw-body Stripe signature; an unverified browser cookie or an Auth-provider failure must not prevent webhook processing.

Session cookies are finalized after Proxy finishes its Auth and subscription checks. `utils/supabase/middleware.ts` accumulates Supabase cookie writes and applies them to the final pass-through, redirect, or API error response. Pass-through responses forward the updated request cookies to downstream handlers, avoiding a second refresh with an old token. Cookie attributes and expired chunk deletions are preserved; responses that write Auth cookies carry private/no-store cache headers. Redirects and JSON responses retain their destination, status, and body without forwarding internal request headers to the browser.

An invalid refresh token is an Auth/session condition, independent of Stripe cancellation and Founding Member identity. Supabase-provided cookie removals must reach the browser even when Proxy redirects an unauthenticated dashboard request to login. This prevents a dropped cleanup response from repeatedly presenting the same rejected cookie; it does not guarantee that refresh errors can never occur. Regression tests exercise the real Proxy and cookie adapter with a mocked Auth provider, including refresh, cleanup, verification/billing redirects, 403/402 responses, and public/webhook exclusions. Hosted-browser validation remains necessary after deployment.

The bypass was verified using mocked authenticated-but-unconfirmed sessions, including direct handler calls. This does not establish that the deployed Auth provider currently issues such sessions; the application must enforce its policy independently. No Supabase Auth settings, database constraints, or RLS policies were changed. Direct browser-to-Supabase access is governed by RLS and is outside an application Proxy's protection. Real signup/confirmation and hosted-provider flows still need preview verification.

### Confirmed account business-name saves

`PATCH /api/account` requires a non-null/non-array JSON object and a string `business_name`, trims it, and enforces a 200-character normalized limit. Empty/whitespace strings still clear the name to null. Extra ownership, business identity, financial settings, email, and plan fields are not written. The route uses `upsertBusinessProfile(validatedUserId, { business_name }, sessionClient)` on the existing unique `user_id` constraint, applying existing RLS instead of the previous service-role client. Upsert handles a missing profile; success requires a returned profile with the authenticated user ID and expected persisted name. The former update-only path could return success with zero matching rows. No new DB constraint or migration is required; existing partial-profile merge behavior is reused.

PATCH returns `{ success: true, business_name }` with the normalized persisted value. GET still returns only business name, creation timestamp, and the validated Auth email, with null profile metadata when no row exists; GET does not create a profile. Both successful responses disable caching. Profile read/write failures return generic 500 JSON with requestId and `account:profile:load:error` / `account:profile:save:error` logs containing only requestId and authenticated user ID. Returned database errors and missing/mismatched write results are not reported as success. Existing session/email verification and paid-subscription Proxy behavior remain unchanged.

`BusinessNameField` owns the name editor within AccountCard. A real form handles Enter and Save through one guarded submission path. Input, Save, and Cancel are disabled while saving; a synchronous ref prevents duplicate submissions before React renders the pending state. The client requires HTTP success, JSON `success: true`, and the exact normalized name before updating its confirmed baseline. Failed/HTML/empty/invalid responses keep the draft and show fixed retry feedback. Cancel restores the latest confirmed name, fixing the previous reset to the original page prop after a successful save. Success remains visible until the next edit instead of relying on a timer. The editor resets when the server-provided account email/name changes; unsaved drafts are not persisted across that reset or navigation.

The input has an associated label, organization autocomplete, a length bound, linked validation feedback, and a visible keyboard focus indicator. Pending state uses `aria-busy`, errors use alert announcements, and success uses a status announcement. Focus moves into the field on edit/retry and returns to Edit after Save/Cancel. New styles use existing CSS variables. Names remain plain text: HTML-like characters are not stripped from stored names, and React escapes them when rendering. The new component calls the API, not Supabase directly. Local state is not written to browser storage.

Mocked API/client tests reproduced malformed-input, zero-row/false-confirmation, service-client, and error-contract gaps and cover allowed name/clear values, owner/field scoping, Auth/Proxy gates, missing/mismatched confirmations, network/HTML failures, and rendered form accessibility/escaping. These tests do not establish live RLS behavior or mounted browser interactions. Preview validation must check persistence, latest-confirmed Cancel behavior, Enter submission, pending controls, failure/retry, and unchanged financial thresholds. No production profiles were accessed or changed. Email-change and billing flows are outside this update. No optimistic version conflict handling is added: concurrent name changes still follow database write order, and a lost response can follow a committed save.

### Unavailable AI endpoints do not consume allowance

`POST /api/ask-cfo` and `POST /api/insights` remain unimplemented. After the existing session/email-verification and feature-plan gates, eligible requests return 501 with their established coming-soon message, code `FEATURE_NOT_IMPLEMENTED`, and `Cache-Control: no-store`. They do not fetch billing-period details or usage, increment counters, send/mark warning emails, or schedule Growth fair-use delays. The response omits the old `usage` payload and `X-Usage-*` headers because no usage operation occurred. Accounts without the required feature still receive the existing 402 plan response, and the Proxy's paid-subscription boundary remains in force. A subscription lookup failure still fails closed through the shared safe API error boundary.

Previously both placeholder handlers called `checkAndIncrementUsage()` before returning 501. A Core request could consume a question/insight allowance without receiving an AI result; Growth Ask CFO requests could trigger warning mail or a five-second fair-use delay, and exhausted allowances could mask the placeholder response with 429. Regression tests run the real Auth/feature/usage helpers with mocked DB/email operations and reproduce the route behavior without contacting providers. Coverage includes eligible/blocked tiers, missing/invalid/unverified sessions, subscription failures, repeated requests, exhausted quota, warning thresholds, and the absence of throttling. Separate Proxy tests retain verified-email and paid-account boundaries.

This fix prevents future placeholder charges; it does not reconstruct or refund historical counts, and no production usage rows were inspected. The shared usage helper, configured quotas, warning acceptance/retry logic, pricing, billing, and Founding Member rules are unchanged. Other unimplemented endpoints already bypass usage accounting and are outside this change. No SQL migration, settings change, or browser-storage change is required. Hosted API validation remains pending.

When real AI processing is implemented, usage reservation/concurrency, successful completion versus upstream failure, ambiguous provider outcomes, and retry/idempotency semantics need an explicit design before reintroducing accounting. This placeholder fix does not establish a general success-only usage transaction or implement any AI capability.

### Atomic action updates and status history

`lib/db.ts:updateAction()` calls `public.update_action_with_audit` once using the authenticated session client, passing the authenticated user UUID, action UUID, validated partial update, and optional audit note. Previously it fetched status without a lock, committed the UPDATE, then inserted an audit entry separately and ignored a returned insert error. A failed audit could therefore be reported as success, and concurrent status changes could use stale old-status values. Mocked regression tests reproduced the false success; no production rows were inspected or repaired.

`docs/migrations/2026-10-23-atomic-action-update.sql` installs a SECURITY INVOKER RPC with an empty search path and explicit table references. EXECUTE is granted to authenticated, not PUBLIC/anon/service_role. It requires `auth.uid()` to match the supplied account UUID, locks the owned action with `FOR NO KEY UPDATE`, applies only the allowlisted editable columns, and inserts status history using the locked previous status and actual UPDATE result. Existing RLS and table privileges apply to both writes; the function does not elevate rights or replace RLS. Direct browser-to-Supabase access remains governed by existing RLS; API email verification, subscription eligibility, and preflight checks remain unchanged.

SQL validates a non-empty JSON object, rejects ownership/ID/timestamp fields and invalid field types/enums, and preserves explicit nulls for nullable fields. Optional audit notes remain supported with a 500-character bound. Completion/timestamp and active-capacity triggers still run. A failed UPDATE, capacity check, or audit insert aborts the entire RPC, including action fields, timestamps, and history. Same-status retries and non-status edits add no status-history entry; a real transition adds one entry with the prior/new status, account/action IDs, and optional note. Concurrent calls on the same action serialize on its row, so history compares against the current committed state rather than an earlier application read. This is not general request idempotency or optimistic version checking; repeated non-status writes can still update timestamps, and a lost HTTP response can follow a committed transaction.

The helper checks the returned action/account IDs before confirming success and has no fallback to separate writes if the migration is missing. The PATCH route retains its existing 403 capacity response and safe generic 500 handling. No action-creation/deletion behavior, prices, plan limits, billing fields, Founding Member identity, financial data, or UI components change. Existing history is not backfilled, repaired, or made immutable. Writes that bypass this RPC do not gain automatic status history; deletion still follows the existing cascade policy. No new audit trigger is installed, avoiding a migration/deployment interval where the old application's manual audit insert would duplicate a new trigger's entry. If the deployed database already has an independent automatic status-audit trigger, the verifier's exact-entry-count assertion will expose that conflict before deployment.

Deployment order: the capacity guard must already be installed; apply the atomic-action-update migration in preview, then run the complete `verify-atomic-action-update.sql` with two dedicated preview account UUIDs and `preview_confirmed := true`, including its final ROLLBACK. Never run the verifier in production, including on production test accounts. It temporarily creates fixtures, changes the first account's feature tier, and injects a scoped audit-insert failure. It checks caller/RLS access, account isolation, exact history count, same-status/non-status updates, nullable fields, invalid RPC input, completion timestamps, late-failure rollback, and preserved capacity enforcement. Local tests mock database calls and do not prove SQL execution or row-lock behavior. SQL verification, hosted behavior, and actual concurrent transactions remain pending; no production services were accessed. After preview validation, apply only the migration to production before promoting the application code. No policy changes or historical cleanup scripts are included.

### Atomic active-action capacity enforcement

The POST action route and completed-action reopening route retain their fast, user-friendly `getActionLimitState()` preflight. That read is not a concurrency boundary: two requests can see the same remaining slot, and a PATCH's earlier status read can also become stale. The repository previously performed count/read and save as separate calls. No deployed-database bypass was tested during this change.

`docs/migrations/2026-10-23-action-capacity-guard.sql` installs an `AFTER INSERT OR UPDATE` row trigger on `public.actions`. Any insertion, reopening, or ownership reassignment that takes a new active slot locks that account's existing subscription row until transaction completion. After obtaining the lock it reads the current tier and counts active actions in a separate query. The trigger is explicitly VOLATILE and requires READ COMMITTED (or PostgreSQL's equivalent READ UNCOMMITTED) so a waiter gets a fresh count after the preceding holder commits. Stronger-isolation acquisitions fail closed rather than relying on a stale snapshot. The inserted/reopened row is already included, so rejection uses `count > limit`, not `>=`. This follows PostgreSQL's [snapshot rules for volatile functions](https://www.postgresql.org/docs/current/xfunc-volatility.html) and [transaction isolation behavior](https://www.postgresql.org/docs/current/transaction-iso.html).

Existing limits remain suspended 0, Starter 10, Core 50, and Growth/Advisory unlimited. The SQL mirrors `USAGE_LIMITS`; an automated consistency check requires future limit changes to update both. A partial index supports the per-account active count. Missing/unknown subscription tiers fail closed for new active slots. The guard does not create subscription rows or write billing/Founding identity. Because it is a table trigger, direct writes and multi-row statements also pass through it; it is not limited to the application API. Normal role/RLS authorization still determines whether a row may be written. The SECURITY DEFINER trigger function has an empty search path, explicit public-table references, postgres ownership, and no direct execute grants to application roles; elevated rights are used only to lock/read the authoritative subscription and complete action count.

Completion, deletion, and edits/transitions that take no new active slot remain possible after a downgrade. Existing over-limit actions are preserved; no data cleanup is performed. A rejected statement rolls back its attempted row changes. This does not make existing application-side action audit writes atomic, add idempotency, or reserve capacity for future requests. Subscription tier changes coordinate through the same row lock but can still leave existing actions above a newly reduced limit. Transactions taking slots for several accounts should use a consistent account order; deadlock errors remain retryable database failures, not successful saves.

The database signals a full account with SQLSTATE `P0001`, exact message `action_limit_reached`, and numeric limit in DETAIL. `getActionCapacityError()` accepts only that exact contract with a known finite tier limit. POST/PATCH convert it to the existing 403 `{ error: "limit_reached", limit }`, including when preflight passed or PATCH's earlier read was stale. Unrelated errors remain generic 500 with requestId and safe create/update logs. No new DB calls are added to React components, and no financial values are hardcoded in components.

Deployment order: apply the migration in preview first, then run the COMPLETE preview-only `verify-action-capacity-guard.sql` with two dedicated preview accounts and explicit preview confirmation. It temporarily changes the first account's tier and actions and ends in ROLLBACK; never run it in production, including on production test accounts. It checks all tiers, exact/full capacity, reopen rejection/release, downgrade edits/completion, multi-row rollback, authorized direct writes, cross-account RLS denial, and unchanged billing/Founding identity. Tests in the app mock the database signal and check response handling; neither those tests nor the sequential SQL verifier establish concurrent lock behavior. PostgreSQL tooling is unavailable locally, so SQL execution and actual overlapping-transaction validation remain pending. Apply only the migration to production after preview verification, before promoting the API changes. Existing timestamp and audit triggers are retained.

Validation update: the user reported successful execution of the preview sequential verifier after supplying the test-account UUIDs and explicit preview confirmation. SQL was not executed by the agent. The preceding local-tooling limitation remains; actual overlapping-transaction and hosted API validation are still pending.

For an actual concurrency check, use a dedicated active Starter preview account with exactly nine active actions. In two separate SQL sessions (both READ COMMITTED), run `BEGIN` then an INSERT of one distinct test action for that same account. Leave session A uncommitted after its insert. Session B's insert must wait on the subscription row; commit session A, then session B must reject with `action_limit_reached` / DETAIL `10`. Roll back session B, verify only ten active rows remain, and remove only session A's newly inserted test action. Both sessions must use the same account UUID and `public.actions(user_id, name, goal_type, status)` with a unique test name, goal_type `risk_mitigation`, status `not_started`. Never run this on production or a customer account. If session A rolls back instead, session B may succeed because the slot was released; roll it back afterward. Browser validation should also confirm the existing upgrade/limit message and that completion frees a slot. No hosted concurrency test has been performed by the agent.

### Validated and confirmed password changes

`PATCH /api/auth/password` accepts only a non-null, non-array JSON object containing non-empty string passwords. The existing minimum of 8 characters for the new password is unchanged; Supabase's configured password policy remains authoritative. Passwords are passed unchanged (no trimming). Invalid input returns 400 before password verification or update calls. Existing `requireAuth` session and verified-email checks remain in force. This account-security endpoint remains accessible without an active paid subscription under the existing Proxy policy.

Reauthentication uses the validated session's email, ignores posted identity fields, and requires both the returned user and session user to match the original authenticated UUID before `updateUser({ password })` runs. A missing authenticated email is rejected. Missing/mismatched reauthentication data fails closed with 503; missing/mismatched update identity never produces success. These checks are defensive provider-contract validation, not evidence of a demonstrated cross-account exploit. The existing session client is retained, so successful reauthentication can refresh session cookies; this change does not introduce a service-role password update.

Provider error codes distinguish an incorrect current password (400, `CURRENT_PASSWORD_INCORRECT`), rate limiting (429, `PASSWORD_RATE_LIMITED`), new-password policy/same-password rejection (422, `PASSWORD_REJECTED`), and unavailable reauthentication (503, `PASSWORD_CHANGE_UNAVAILABLE`). Unknown update failures return 500, `PASSWORD_CHANGE_FAILED`. Unexpected returned provider failures and identity mismatches log only `auth:password:error`, requestId, and a fixed phase; thrown failures use the shared API boundary. Raw provider messages and password values are not logged or echoed by this route. No rate-limit, Auth, or password-policy settings were changed.

The form requires HTTP success and JSON `success: true` before clearing fields or announcing completion. Known status/code pairs map to fixed, safe messages, with field-specific guidance for incorrect/current or rejected/new passwords and form-level feedback for other failures. Network errors, HTML/empty responses, and malformed success bodies never confirm success; guidance acknowledges that a lost response can follow a completed password update. A synchronous submission guard and disabled fieldset prevent repeated submissions/edits while pending. Error/help IDs are linked to inputs, errors use alert announcements, success uses a status announcement, and the success timer is cleared on unmount/retry. Passwords are not persisted in browser storage.

API/client tests mock Auth and fetch, covering invalid input before mutations, account scoping/order, provider failures, ambiguous outcomes, response confirmation, and rendered form accessibility. Actual browser interaction and password rotation/login still need a dedicated preview account; no real passwords were changed during automated verification. This work does not change recovery flows, MFA/reauthentication-nonce behavior, other-session revocation, billing/Founding Member policy, schema, or RLS. No SQL migration is required.

### Shared authenticated API error boundary

`lib/apiAuth.ts` awaits the wrapped handler inside its try/catch. Previously it returned the promise directly, so asynchronous handler failures (including a rejected subscription lookup) escaped the intended JSON error boundary. Unexpected application failures during session-client creation, Auth lookup, or handler execution now return 500 JSON `{ error: "Internal server error", requestId }` with `Cache-Control: no-store`.

The fallback logs `requireAuth:error` with the same requestId and a phase (`authentication` or `handler`). It does not log raw exception messages/objects, submitted values, email addresses, tokens, or query strings. Next.js `unstable_rethrow()` runs first in the catch, as documented by the installed framework, so redirects, not-found signals, and request-time rendering exceptions remain under framework control. This matters because session-client creation calls `cookies()`.

Deliberate route responses are returned unchanged, including status, body, headers, and cookies. Existing 401/403 checks, authenticated user/client/context forwarding, paid-subscription Proxy checks, feature gates, and Founding Member behavior are unchanged. Route-specific error handling still takes precedence; this fallback does not validate request bodies, sanitize other routes' own logs, cover unwrapped routes, or roll back writes completed before an error. Callers must not assume a 500 means no mutation occurred.

Regression tests reproduce asynchronous rejection through the real subscription route and cover synchronous/non-Error failures, Auth/client rejection, safe correlated logging, unchanged responses/context, and framework control flow. No database migration, RLS change, external configuration, or production service access is required.

### Validated and confirmed alert dismissal

`POST /api/alerts/dismiss` requires a non-null/non-array JSON object, an exact supported alert code, and one of `data_reload`, `24h`, or `7d`. Malformed JSON and unknown/incorrectly typed values return 400 before database work. `lib/alertPolicy.ts` defines the shared protected/dismissible code policy used by the route, UI, and `isAlertSnoozed()`. Critical runway and cash-below-reserve alerts remain non-dismissible: the API returns 403, the UI omits their control even if severity metadata is inconsistent, and calculations keep them visible despite any stored dismissal.

The route looks up the authenticated user's data_version and checks the query error before writing. A failed lookup returns 500 without saving a dismissal. Data-reload snoozing without a non-null version returns 409 without writing, because such a record cannot suppress an alert under the existing calculation rules. Timed snoozes can still work without a version. Expiry is generated from server time (24 hours or 7 days), and supplied account IDs, expiry, and data_version are ignored. Writes use the validated user ID and session client. Write failures return generic 500 JSON with requestId and safe `alerts:dismiss:error` logging. Auth/email verification and paid-subscription gating are unchanged.

The client uses `lib/alertDismissal.ts` and removes an alert only after an OK JSON response containing `success: true`. HTTP errors, malformed/HTML responses, or a network failure keep the alert visible. Missing-version conflicts provide guidance to import data or choose a timed snooze; unconfirmed results ask the user to refresh before retrying. The control is disabled/spinning with aria-busy while pending; failure feedback is announced as an alert. Its timer is cleaned up on unmount. Removing the optimistic parent removal also prevents the failure-toast owner from being unmounted before it can report an error. No restore callback or reinsert ordering is required.

Tests reproduced previous malformed-input, permissive-value, ignored-lookup-error, ineffective-snooze, and uncaught-write failures with mocked database calls. Coverage includes Auth/account scoping, server-generated expiry, protected alerts with existing dismissal records, version changes, timed expiry, response confirmation, and rendered controls. Browser interaction still requires preview validation. Lookup and dismissal remain separate requests: an intervening import can make the recorded version stale, in which case the new-version alert remains visible on refresh. This change does not serialize dismissal with imports or provide exactly-once delivery. No schema/RLS migration, billing change, or stored-record cleanup is included.

### Account-scoped alert preference loading and saving

`AlertPreferencesCard` loads its value from `GET /api/settings/preferences` through `lib/alertPreferences.ts`. Loading performs no PATCH and never reads the browser-wide legacy `elidan_snooze_duration` value, which has no account identity and could belong to a previous user. The old key is removed on a best-effort basis; blocked storage or failed removal cannot prevent server preference loading. Server values are authoritative. Existing database values are retained; this change does not identify or repair values previously overwritten by the legacy migration.

The card remains in loading/error state with Save disabled until the server returns one of `data_reload`, `24h`, or `7d`. Lookup failure, invalid data, and HTML/SSO responses show a retry state rather than making a browser/default value appear saved. Each load ignores completions after its effect is cleaned up; the settings page keys the card by the validated account ID so a new server-rendered account gets fresh component state. This does not implement cross-tab Auth change detection. Radio controls are disabled during saving, acknowledgement requires `success: true`, and old success timers are cancelled before a new save and on cleanup. Loading/success use status announcements; errors use alert announcements.

The preferences API reads/writes only the authenticated user's `business_profiles.snooze_duration`, using the session client and existing RLS. GET disables caching and rejects an invalid stored enum. PATCH requires a non-null, non-array JSON object and an exact valid snooze value; missing/unknown/incorrectly typed values return 400 before writes. Auth/email verification and paid-subscription Proxy policy are unchanged. Database failures return generic 500 JSON with requestId, with safe load/save log labels instead of exposing raw database errors. Extra ownership/plan fields are not written.

Automated tests cover differing successive account responses, no migration PATCH/read of legacy storage, unavailable storage, failed/invalid loads, retry, confirmed/failed saves, initially disabled UI, API validation, account scoping, and Auth failures. Browser interaction, offline/retry display, and actual account-switch behavior still require preview validation. No schema, RLS, subscription, billing, or danger-alert dismissal rule changes are included. Browser-only preferences with no saved server equivalent must be selected explicitly; there is no automatic legacy transfer.

### Financial threshold save API

`PATCH /api/settings` requires all four threshold fields. Warning/danger months and burn percentage must be finite JSON numbers. `min_cash_reserve` must be a finite JSON number or explicit null (unset/disabled). Malformed/non-object bodies, missing fields, strings, booleans, arrays, objects, invalid nulls, and overflowing numeric literals return 400 before profile writes. The API does not coerce input with Number(). The form submits numbers and uses null for a blank cash reserve, preserving the existing nullable stored state.

Warning/danger months and burn percentage must be positive, danger must be strictly less than warning, and a numeric cash reserve may be zero but not negative. Fractional months and burn-rate increases above 100% remain valid; no new product maximums were introduced. `percentageFromDecimal` / `percentageToDecimal` in `lib/calculations.ts` shift the shortest decimal representation by powers of ten to retain fractional percentages without multiplication/division display noise. The percentage sent by the form is converted once to the stored decimal (10.5 becomes 0.105); an extremely small percentage that underflows to zero is rejected. The schema and alert calculation already support null reserve; preserving null avoids silently converting an unset value to zero while editing another threshold.

Only the four allowed fields are written, using the validated Auth user ID and session client. Extra account IDs, plan fields, and business identity fields cannot change ownership or be mass-assigned through this endpoint. Auth/session and email-verification checks remain enforced by requireAuth, and the existing subscription guard is unchanged. Success requires the returned row to match the account and all requested stored values, then returns `success: true` with no-store caching. Missing/mismatched/rounded results and database failures return generic 500 JSON and requestId; logs record `settings:thresholds:save:error` with that request ID and authenticated user ID, without raw database details or submitted values. A failed confirmation can follow a committed write; it is not a rollback guarantee. Invalid bodies return 400 before writes.

Route tests cover strict input rejection before writes, nullable reserve, valid ranges, decimal percentage conversion, persisted-row confirmation, account scoping/field allowlisting, and Auth boundaries. No live settings or production data were changed. No migration, backfill, or billing change is included; prior rounded or otherwise stored values are not reconstructed.

### Confirmed threshold editor saves and previous-value restores

`ThresholdsCard` subscribes to an editor instance from `lib/thresholdSettings.ts`, scoped to its component/account. Saved values, drafts, previous-value history, and pending/errors are updated synchronously through one workflow; there is no global store or browser persistence. Saves and restores validate the complete candidate before sending. Saved/previous indicators remain unchanged while pending and change only after an HTTP success containing JSON `success: true`. Failed requests and malformed/HTML responses retain draft, last-confirmed baseline, and history with fixed retry/refresh guidance, without displaying arbitrary API text. The saved indicator means last confirmed state, not proof that a lost response left the database unchanged.

A restore builds its payload from the last-confirmed values with only the selected field replaced. Unrelated drafts are kept in the editor and not written. An invalid restored warning/danger combination is rejected locally without consuming history. A successful restore removes only that field's previous entry. New ordinary saves record only changed fields as previous; local reset of an unsaved field performs no request. Saving with no edits is a no-op. The synchronous pending guard blocks overlapping Save, Restore, Reset, and Edit operations before React rerenders; a disabled fieldset reinforces this in the UI.

The form supports Enter submission and decimal number inputs (`step=any`), with existing positive/range checks retained. Blank cash reserve is explicitly described as disabling the reserve alert, matching the existing calculation's null check, while explicit zero is retained as zero. Inputs link helper text; reset controls distinguish local reset from persisted restore in their accessible labels. Pending uses aria-busy, errors use alert announcements, and success uses status announcements. Success stays visible until the next edit/operation instead of stale timers clearing a newer result. Styles use CSS variables. The settings page keys the editor by account and server threshold values, so new server values/account changes reset the baseline and session-only undo history; unsaved drafts are not merged across such resets.

Async regression tests use deferred promises against the actual editor workflow to cover pending state, failed restore/retry, preserved unrelated drafts, duplicate operations, invalid combinations, and history retention after a later save failure. Rendering tests reproduce whole-percent rounding and verify fractional inputs; client tests require explicit acknowledgment and handle network/HTML/status failures. Local tests do not validate live schema precision or mounted browser behavior. Preview testing must confirm fractional values persist after reload, blank reserve stays blank, forced restore failure retains state/history, retry works, and other drafts are not accidentally saved. No database migrations or changes to alert formulas, subscription/Founding policies, or other financial records are included.

### Welcome-page notification feedback

Coming-soon plan cards call `lib/notifyRegistration.ts:registerFeatureNotification()`. The UI marks a tier registered only after an OK response containing `success: true`; HTTP failures, malformed/HTML responses, and network failures produce an inline, card-specific retry message with `role=alert` and `aria-describedby`. While a request is pending, notification buttons are disabled and the active button has `aria-busy`; success is announced with `role=status`. No browser storage is required. Other card errors and checkout state are independent.

The paid-subscription guard previously returned 402 to the welcome page's verified users without active subscriptions, and the client silently ignored the failed response. Proxy now exempts only `/api/notify-me` from that check; verification and all unrelated API gates remain in force. Regression coverage reproduces the missing exemption and checks exact-path matching, preserved verification/paid boundaries, response handling, and rendered loading/error/success accessibility states. Full browser click behavior still requires preview validation. No schema, RLS, billing, or Founding Member policy changes are involved.

### Application email acceptance and HTML safety

All application-controlled Resend sends use `lib/emailDelivery.ts:sendEmail()`. It checks both the SDK's returned `error` and a nonempty email ID; a resolved promise alone does not establish success. Provider rejection, missing acknowledgement, and thrown errors return false and log `email:delivery:error` with the calling context, reason, and a bounded HTTP error status when available. Raw provider messages, exceptions, recipients, HTML, and keys are not logged. A provider ID means accepted for sending, not delivered to the inbox; bounces and later delivery failures require separate provider-event handling.

Billing/Founding/CFO notification helpers retain their best-effort behavior, so an email failure never undoes successful subscription processing or makes a completed billing write retry solely for email. These helpers do not provide durable retries. Dynamic text and quoted HTML attributes are escaped with `escapeHtml()` at their insertion point, including booking/dashboard/billing links, title text, member values, and notify-me fields. Escaping applies to dynamic content, not template markup or plain-text subjects. Configured link destinations remain trusted configuration; escaping is not URL scheme validation. Existing Founding cancellation/reinstatement terms are unchanged.

`POST /api/notify-me` returns 400 for invalid JSON/non-object bodies, unsupported features, and invalid email input, including angle brackets, double quotes, or addresses longer than 254 characters. It trims the address, preserves its case, and retains the existing unique `(email, feature)` conflict handling; this change does not merge case variants. Request-supplied user IDs are ignored; optional attribution uses the validated Auth user only when Auth returns no error. The upsert returns the inserted email field so ignored duplicates can return success without sending another support notification. Success confirms the registration was saved, not that support email was delivered. Saved registrations survive notification failure; there is no retry for the support email on duplicate registration.

Growth usage warnings are marked with `warning_sent_at` only after provider acceptance. If acceptance fails, later eligible requests at or above 100 questions, while passing the existing usage path, retry the warning until a send is accepted and the flag is saved. A failed flag write logs `usageGate:warning:markFailed` without failing already-committed usage. Usage accounting and limits are unchanged. Concurrent requests, an ambiguous network result, or a failed flag write can still cause duplicate emails; no exactly-once guarantee or transactional outbox is introduced. Existing sent flags are not backfilled.

Regression tests mock Resend and database calls, covering resolved provider errors, exceptions, missing IDs, log redaction, template escaping, current Founding policy, notify-me duplicates/input/attribution, and usage-warning acceptance/retry. No real email was sent by the agent. No database migration, RLS change, or mail-provider configuration change is required. Hosted registration and actual provider delivery still require preview validation with an explicitly authorized recipient.

### Atomic database writes

Related database writes that enforce one business operation must commit atomically when partial completion could lose data, corrupt state, or grant incorrect access. Use one transaction with explicit account ownership, consistent concurrency locks, and rollback tests. This is the intended pattern for such operations, not a claim that every existing write has already been converted. Financial import and financial clearing implement it through server-only RPCs. Stripe and email calls cannot participate in a database transaction; they require separate idempotency, retry, and reconciliation policies, with an outbox when reliable delivery is needed.

### Atomic financial workbook import

`POST /api/import` validates the Supabase Auth user, confirmed email, and paid subscription before reading the upload or creating a service client. Missing/non-file uploads, malformed forms, unreadable workbooks, parser errors, empty imports, duplicate months, invalid month keys, and non-finite financial/profile numbers return 400 before replacement. Existing warnings and success-response fields remain available to the UI.

`lib/db.ts:replaceFinancialImport()` calls `public.replace_financial_import(uuid,jsonb,jsonb,text)` once. The RPC creates/locks the account's business profile, initializes missing workbook business details only during onboarding, clears old categories/months, inserts the replacement months, stamps `data_version`, and writes the success audit in one transaction. After the preserve-import-settings migration, workbook financial thresholds never overwrite account settings and existing business details are preserved. Database exceptions roll all these changes back. Same-account imports and clears serialize on the same profile row; different accounts use different locks. Direct database writes outside these RPCs are not coordinated by this application protocol.

The function is `SECURITY INVOKER` with an empty search path and explicit public table names. Only `service_role` can execute it; PUBLIC, anon, and authenticated access is revoked. The verified API supplies `p_user_id` from Auth, never request/form/workbook ownership fields. SQL also rejects unexpected payload fields and duplicate/non-month dates. No subscription, Stripe, or Founding identity writes occur during import. Service credentials remain server-side.

Success auditing and the data version are part of the transaction; separate pending/success requests and post-import subscription initialization are removed. Failure auditing remains best effort. Errors sent to the browser include a request ID without raw database details. A lost RPC response can leave commit status unknown, so the UI directs the user to refresh before retrying; this change does not provide exactly-once requests.

Deployment order: apply `docs/migrations/2026-10-23-atomic-financial-import.sql` in preview, then run `docs/migrations/verify-atomic-financial-import.sql` as postgres with two distinct dedicated preview test-account UUIDs, then deploy the app change to preview and test an import/replacement. The verification script uses a forced failure at the final audit write to assert restoration of months, categories, profile, version, and audit history; it also checks account isolation, billing preservation, payload rejection, and execution privileges. Its final ROLLBACK discards all test changes. If it fails, run ROLLBACK before retrying. Do not deploy the route before the migration: a missing RPC returns an error with no destructive fallback.

Automated route/adapter tests mock database calls and include the real Excel fixture parser. They do not execute PostgreSQL or prove live rollback, grants, schema compatibility, or concurrent-lock behavior. Preview SQL and hosted testing are required before promotion. This change does not backfill data from previously failed imports.

### Preserve account settings during workbook refreshes

Settings is the authority for all five account alert thresholds: cash reserve, runway warning/danger, burn-rate warning, and invoice-overdue days. Workbook values are ignored on every upload, including the first financial upload. A profile can already exist before that upload, so neither first import nor profile existence establishes that its settings are untouched. New profiles use database defaults; imports never infer permission to change preferences from empty financial data or null reserve. Null reserve, explicit zero, and fractional percentages remain distinct and unchanged.

`lib/financialImportPolicy.ts` defines the excluded fields and explanatory messages. The database adapter removes threshold keys from its payload without mutating the parser result. The upload API appends messages when parsed workbook thresholds or business details exist; both the dashboard and onboarding success states display them. Workbook ownership fields remain forbidden by SQL. Parser syntax and the existing finite-number validation remain unchanged.

Onboarding already saves the business name through `/api/account` before importing the workbook. The old import behavior could immediately replace that name with the template's sample name. Business name, industry, accounting system, and employee count now initialize only when that specific stored field IS NULL and `onboarding_completed_at IS NULL`. Existing values, including zero employees and empty strings, never get replaced. Once onboarding completes, even null fields remain untouched by imports. The decision is made in SQL under the same profile-row lock used by imports, settings writes, and onboarding updates; the API never takes a separate stale eligibility snapshot. Explicit account edits use their dedicated flows. Industry/accounting-system/employee-count editing is not currently exposed in Settings; adding those controls is separate work.

`docs/migrations/2026-10-23-preserve-import-settings.sql` replaces the existing transaction function, retaining its signature, account lock, validation, role restrictions, financial replacement, version stamp, and success audit. It accepts legacy threshold keys but strips them before typed record conversion and never updates threshold columns. This protects against older app instances during deployment. It installs a function only and does not repair previously overwritten settings. This migration changes upload behavior only. Clear Data also preserves thresholds after the later 2026-10-24-preserve-settings-on-financial-clear.sql migration; do not use the older reset behavior as current policy.

Apply the original atomic-import migration first if absent, then the preserve-import-settings migration in preview. Run the COMPLETE `docs/migrations/verify-preserve-import-settings.sql` as postgres, set `preview_confirmed := true`, and supply two distinct dedicated preview-account UUIDs. It rolls back all fixtures and its temporary failure trigger. Never run this verifier in production, even with test accounts. Checks include legacy payloads, ignored uncastable threshold values, fractional settings, null/zero reserves, initialization of missing onboarding details, preservation of existing onboarding details, completed-account details (including null fields), financial replacement, late-failure rollback, grants, billing preservation, and account isolation. On failure run ROLLBACK in the same session. Apply only the migration in production before promoting the application change. The old atomic-import verifier now explicitly seeds a null onboarding name to check initialization; the new verifier adds preservation checks.

Local route/adapter tests first reproduced threshold leakage from the real workbook fixture and cover exclusion, the warning, null/zero values, and existing import errors. They mock PostgreSQL and do not prove deployed function behavior, column precision, contention, or live rollback. Preview SQL and hosted import/reload checks remain required. The clear-data verifier now seeds its non-default thresholds directly, since uploads intentionally no longer apply its fixture's threshold values. No production services were accessed. The settings-preservation change itself adds no history; the financial revision history increment below now retains displaced datasets. Recovery UI and forecast/insight revision references remain future work. Import modes and reviewed uploads are defined below. Full replacement semantics are unchanged.

### Financial revision history before replacement

`docs/migrations/2026-10-23-financial-revision-history.sql` adds database-only revision capture to the existing import transaction. After acquiring the account's profile lock and before changing profile fields or deleting financial data, a successful replacement archives the displaced financial months and expense categories as ordered JSON arrays, their row IDs/timestamps, the prior `data_version`, and an explicit snapshot of business details and the five alert thresholds. Settings are captured as they exist at replacement time, not as they necessarily existed when older insights were produced. No billing, credentials, Auth records, or arbitrary future profile fields enter the snapshot. The incoming filename is labeled `replaced_by_filename`; it identifies the replacement operation, not the original source of the archived values. An empty prior dataset creates no revision; category-only prior data is also eligible for capture.

`public.financial_data_revisions` uses an account UUID referencing `auth.users ON DELETE CASCADE`, an identity primary key for ordering, a capture timestamp, format version 1, nullable text source data version, replacement filename, and three JSON payloads. Object/array shape checks and required fields guard storage structure. Its `(user_id, id DESC)` index supports retention and future account-scoped history queries. It is server-only: RLS is enabled and forced, no browser policies are added, and PUBLIC/anon/authenticated have no table/sequence grants. Service-role default privileges are explicitly revoked and replaced with SELECT/INSERT/DELETE and sequence usage/select; it cannot UPDATE retained revisions. This is access control, not a tamper-proof audit log: the database owner and trusted server role can delete history. No new browser API, restore endpoint, history UI, or browser-storage copy is introduced.

The most recent **20 displaced datasets per account** are retained, plus the current working dataset. Retention is by operation count, not age; repeated identical uploads consume revisions because request idempotency/deduplication is not introduced here. Identity ordering avoids timestamp ties; identity sequences may have gaps after rollback. Revisions older than the newest 20 are pruned under the same account lock and transaction. A snapshot, pruning, financial write, or final success-audit failure rolls back the entire import, including inserted/pruned revisions and profile/data-version writes. Failed requests do not commit a revision; the route's separate best-effort error audit remains possible. A lost HTTP response can follow a committed replacement, so existing refresh-before-retry guidance still applies.

Clear Data remains an application-level permanent deletion: under the same account lock it purges **all retained revisions for that account**, deletes current categories/months, preserves all account thresholds after the preserve-settings-on-financial-clear migration, advances the data version, and writes its success audit atomically. It never archives the data being cleared. A history-purge or late-audit failure rolls the clear back, including restored revisions. Account deletion cascades revision removal through the Auth-user foreign key. No automatic age-based retention job is installed. Future deletion/retention rules must preserve these semantics and explicitly address any insights or forecasts referencing revisions before such links are introduced.

Install after the preserve-import-settings and atomic-financial-clear migrations. The migration creates storage and replaces the existing server-only RPC implementations, retaining their signatures, response contracts, role restrictions, settings preservation, and replacement behavior. It takes effect when SQL commits, including for the currently deployed app; no application deployment or environment change is needed to activate capture. It does not backfill old versions or snapshot every existing account during installation. The first subsequent replacement captures the prior dataset then present. The source version is preserved as opaque text, matching the deployed business_profiles.data_version type; timestamp-looking strings must not be parsed or normalized. Projects that installed the initial timestamp-typed revision column must apply 2026-10-23-financial-revision-version-text.sql before verification; new projects use the corrected base migration. The repair preserves existing column values/nulls as text without changing current profile or financial data. Schema creation intentionally fails if the new table already exists rather than silently trusting an unknown table definition; the transaction prevents partial installation. Do not rerun older function migrations after this one, as they replace newer function bodies.

Run the complete `docs/migrations/verify-financial-revision-history.sql` in PREVIEW ONLY as postgres, with `preview_confirmed := true` and two distinct dedicated preview-account UUIDs, through its final ROLLBACK. It temporarily replaces both test accounts' data, creates rollback-only failure triggers, and verifies exact prior financial/category values, source metadata (including exact opaque and null version tokens), preserved settings, first-import behavior, newest-20 pruning, grants/RLS configuration, browser SELECT denial, actual service-role execution, other-account history isolation, billing preservation, forced snapshot/prune/late-audit failures, clear-purge rollback, and successful permanent clear. It does not delete Auth users or prove cascade deletion by execution. If it fails, run ROLLBACK before retrying. Never run this verifier in production. Apply only the migration to production after preview SQL/hosted validation. PostgreSQL execution remains pending; local mocked API tests cannot verify database archival or rollback.

The existing two-session lock-contention procedure still applies: hold a dedicated test account's profile row FOR UPDATE in preview session A; calls to import and clear in session B with a short LOCAL lock_timeout must wait/time out. ROLLBACK both sessions. Revisions are read under that profile lock; SQL writes that bypass the import/clear protocol are not automatically versioned or serialized. Hosted validation should save custom settings, import distinct synthetic datasets twice, inspect only that preview account's revisions in the SQL editor, and confirm the archived values are the preceding dataset while the dashboard shows the new one. Clear only a dedicated disposable account to verify history removal. History supports future recovery and provenance work but this increment does not provide restore behavior, update-month mode, an active-revision reference, original upload-file storage, or reproducible AI/forecast snapshots.

### Explicit update-month and full-replacement imports

The dashboard uploader defaults to **Update months in this file** (`update_months`). Each supplied month is a complete replacement of that month's financial values, including clearing omitted/blank nullable fields; values are never added to existing amounts. Other months and their row IDs/timestamps/categories remain untouched. The new SQL engine uses the existing `(user_id, month_date)` unique constraint to upsert uploaded months, preserving IDs/creation timestamps for corrected months and updating their modification timestamp. Uploaded months' old expense categories are deleted to avoid stale breakdowns; the workbook parser still does not import the Expense Categories sheet. Full workbook category importing is separate future work.

**Replace all financial data** (`replace_all`) deletes all current months/categories before inserting the supplied months. The selector explains that months absent from the file will be removed. Both choices preserve account settings and existing business details, retain the same onboarding-only initialization rule, and capture the entire prior dataset before writing. A revision's `operation_mode` identifies which operation displaced it; pre-existing revisions default to `replace_all`. Retention remains the most recent 20 operations, with the same server-only access and Clear Data purge behavior. Revision capture, pruning, category deletion, month writes, profile/data version, success audit, and resulting dataset summary execute in one transaction under the account profile lock.

`docs/migrations/2026-10-23-financial-import-modes.sql` requires revision-history storage with text source versions, adds `operation_mode`, and installs `public.import_financial_data(uuid,jsonb,jsonb,text,text)`. Only service_role may execute; browser roles remain denied. SQL and the API strictly allow only the two exact mode strings, rejecting null/unknown explicit modes. The API defaults an absent mode to update_months for safety and rejects repeated mode fields and file/blob mode values before workbook parsing. Auth, confirmed-email and paid-subscription checks still precede upload reading. Only the validated Auth user supplies ownership. The old `replace_financial_import` function becomes a server-only wrapper that explicitly requests replace_all and retains its original two-field response, so old deployments and existing SQL verifiers preserve their prior semantics.

`lib/db.ts:importFinancialData()` calls only the new engine, strips workbook thresholds, and requires a consistent mode/count/summary acknowledgment. It never falls back to the old replacement function if the migration is absent. The engine returns the complete resulting dataset's count, earliest/latest month, and latest closing cash from inside the same transaction. API `dateRange`, `monthsTotal`, and `currentCash` describe that dataset, while `monthsImported` counts supplied months; uploading an older month cannot mislabel that month's cash as the current dataset balance. The legacy `replaced` boolean still means that financial months existed before the operation; it does not identify the selected mode. The UI uses `mode` for its success wording.

The mode increment originally submitted to `/api/import/modes`. The reviewed-upload increment below supersedes that immediate-write endpoint: new clients use `/api/import/review` and `/api/import/confirm`; `/api/import` and `/api/import/modes` now require users to refresh into the review flow and do not import data. Both dashboard and onboarding use `useImportUpload`; onboarding sends the explicit safe default. `lib/financialImportUpload.ts` supplies a per-uploader synchronous pending guard, explicit multipart mode, strict JSON success validation, and refresh-before-retry guidance for unknown outcomes. Malformed/HTML/legacy/mismatched-mode success responses do not display success, and server failures do not display arbitrary provider text. Parser/authorization errors can retain their actionable controlled messages. No browser persistence or component DB calls are added. The selector has a label and linked explanation; upload controls are replaced by the pending state while in flight. A new upload from the dashboard resets its choice to update_months. Overlaps within one uploader are blocked, but there is no cross-tab idempotency: separate account imports still serialize in SQL and each successful operation may consume a revision.

Deployment order: apply the import-modes migration in preview AFTER financial-revision-history (and its text repair if the initial version was installed). Run the complete existing `verify-financial-revision-history.sql` again for archive/retention/access/clear regressions, then `verify-financial-import-modes.sql` for mode-specific behavior. Both verifiers are PREVIEW ONLY, require postgres, `preview_confirmed := true` and two distinct dedicated preview UUIDs, and must include the final ROLLBACK. The mode verifier checks first import, corrected and new months, blank-field replacement, exact preservation of an untouched month/category, complete prior revisions and operation labels, resulting summary after an older upload, forced late-audit rollback for both modes, invalid modes, explicit full replacement, account/billing isolation, service execution, and legacy response compatibility. On failure run ROLLBACK before retrying. These scripts temporarily replace dedicated test accounts' data; never run them in production. The older function migrations must not be rerun after this migration, or they can overwrite newer engine/wrapper behavior.

Deploy the application to preview only after SQL verification; then upload overlapping/partial workbooks in update mode and confirm omitted months remain, corrections are not doubled, settings stay saved, the summary remains current, and a new revision contains the prior complete dataset. Test explicit replace mode with a dedicated account and confirm omitted months disappear. Apply only the migration in production before promoting the code. Local route/adapter, request-client, and rendered-selector tests use mocks/SSR and cannot prove PostgreSQL execution, concurrency, or mounted browser behavior; preview checks remain required. No schema/data changes or external service calls were made by the agent. Restore UI, original-file storage, import deduplication, cross-tab request idempotency, category-sheet importing, and forecast/AI revision references remain separate increments.

### Revenue vs Expenses chart: truthful gaps, labels and tooltips

The dashboard chart is labelled Revenue vs Expenses (including empty state, legend and tooltips). It plots each stored month's actual revenue/total expenses, not the three-record averaged burn shown by the Monthly Burn card. The existing internal `RevenueBurnChart`/`getRevenueVsBurnChartData` names and stored-value arrays remain for compatibility. The chart summary describes the latest month only: revenue exceeded expenses by an amount, expenses exceeded revenue, equality, or missing-input comparison unavailable. It does not infer positive/negative cash flow, profitability or forecasts from revenue/expense totals.

The chart still selects the latest twelve stored records and counts only those as stored months. Presentation-only NULL gap markers are inserted between nonconsecutive records and the X axis uses numeric calendar-month indexes: October/December have an empty November position and proportionate spacing, and both series explicitly set `connectNulls=false`. A single marker represents a longer missing period, with a tooltip naming its full range, instead of allocating thousands of synthetic rows. At most one marker per gap is added; tick generation is also bounded for sparse long ranges. Short date ranges can label each calendar month, with overlapping labels suppressed responsively. Markers do not become stored financial records, revisions or zero values. A source row with just one missing metric breaks only that series. Linear segments connect actual consecutive observations without smoothing across missing data.

The custom tooltip selects the chart point using the active calendar index rather than relying on a filtered series payload. `filterNull=false` allows missing-point selection; both metrics always appear, NULL is "Not provided", genuine zero is $0.00, and revenue-minus-expenses is signed and displayed to cents only when both values exist. A wholly absent month/period is explicitly identified. Summary/tooltip differences are calculated in `lib/calculations.ts`; the UI only formats the values. Axis abbreviations handle negative amounts and the subtitle identifies monthly USD totals. Chart styles use CSS variables and Inter weights no higher than 500; the title/description label the section and the existing chart keyboard accessibility layer remains enabled.

No DB/API, import behavior, current KPI formulas, comparison guards, retention or SQL migration changes are required. An accessible data table, expanded historical browsing, date selectors and further series differentiation remain later increments. Local tests cover missing markers, calendar/year spacing, bounded long ranges, NULL versus zero, summary signs/equality/missing fields, tooltip values/ranges, chart configuration and empty-state links. They do not prove mounted SVG paths, pointer/keyboard tooltip behavior or narrow-layout readability; validate those in preview using consecutive/gapped/single-month uploads and partially missing values.

### Require consecutive calendar months for month-over-month comparisons

Month-over-month cash, burn and runway comparisons now require the newest two financial rows to be consecutive calendar months. `areConsecutiveFinancialMonths()` in `lib/calculations.ts` validates first-of-month keys and compares calendar indexes without timezone arithmetic, including December/January rollover. The cash adapter only exposes `previousCash` for the immediately preceding calendar month. Missing/unknown prior cash displays "Previous-month cash unavailable"; missing/nonconsecutive burn/runway comparison inputs display "Previous-month data unavailable". Older available records are not substituted for a missing previous month.

`alertEngine()` applies the same adjacency rule to BURN_RATE_SPIKE and REVENUE_GROWTH, preventing February-to-April changes being described as last-month changes. Current-state cash-reserve, receivables and runway alerts remain active. The burn card also requires a positive prior expense value for its percentage display; zero/negative baselines show "Percentage change unavailable" rather than a misleading zero-percent change. Existing comparative alert guards on positive baselines remain unchanged.

Current cash, chart history, stored data, thresholds, and the latest-three-record burn average are unchanged; that burn sample may still span gaps and is not being redefined as three consecutive calendar months. No SQL migration or data repair is required. Regression tests reproduce the original gap/zero-baseline failures and cover calendar rollover, invalid/duplicate/reversed keys, missing inputs, current-state alert preservation and genuine consecutive comparisons. Hosted checks should omit March between February/April, verify comparison placeholders and suppression of comparative alerts, then add March and verify valid comparisons return.

### Preserve unknown closing cash in dashboard metrics

`getCurrentCashPosition()` now preserves NULL closing cash on the latest stored month, instead of converting it to zero. Its result still identifies that latest month and the previous record's balance; it does not fall back to an older known cash value. The Cash Position card shows a neutral em dash and a month-specific missing-cash explanation, with no false comparison or reserve colour. Runway and Cash-Out Date show neutral missing-closing-cash states when financial records exist but current cash is unknown, before any stable/not-burning fallback. Actual numeric zero still displays as $0 and retains the existing zero-runway calculation when average burn is positive. No-records states, known-value formulas, three-record burn windows, month coverage, imports and alert rules are unchanged. No database repair or SQL migration is required: stored NULLs were already correct; the bug was in the read adapter and dependent presentation.

Regression tests first reproduced the adapter's false zero and the runway's false Stable fallback. Coverage includes owner scoping/latest-record selection, missing cash with positive/zero/missing expenses, real zero, prior known cash not substituted, and the no-records state. Preview validation should upload a valid month with revenue/expenses and blank Closing Cash, verify all three cards explain missing cash, then correct Closing Cash to zero and a positive value. Values must remain correct after refresh; historical and settings data must remain intact.

### Financial data page navigation and status

The ongoing upload/review/confirmation/result workflow now lives at `/dashboard/financial-data`, with a Financial data sidebar entry, page loading/error states, template download, existing update/replace modes and Clear Data confirmation. It reuses `ImportUploader`, `ImportReviewCard`, `useImportUpload` and the existing guarded APIs/RPCs. Guided onboarding keeps its shared first-upload flow. No import, settings-preservation, revision-retention, cancellation or calculation policy changes, and no new migration/API, are introduced by the move.

The dashboard replaces its embedded uploader with a compact Financial data status card and Update financial data link. The chart empty-state link targets the new page instead of scrolling to a removed uploader anchor. Status shows the latest financial month separately from the last successful source-import timestamp (explicit UTC), plus missing calendar months within the latest twelve stored records shown by the dashboard. This is dashboard-range coverage, not a claim that all retained historical data is complete. Empty datasets show an explicit empty state. Import-status query failures show unavailable status rather than claiming no imports exist.

`lib/db.ts:getFinancialImportStatus()` uses the authenticated account's existing session client, selects only `created_at`, filters `user_id`, `status=success` and source import types (`excel`, `csv`, `quickbooks`), and returns the newest one. Manual-clear audit records are excluded. Existing dashboard month rows are reused for coverage; no duplicate full financial query is added. The new page rechecks validated Auth user, email confirmation and paid subscription before reading account data, in addition to the existing dashboard/proxy boundaries. DB calls remain in helpers, not status/upload components.

Import/clear success refreshes the Financial data page's server state; it does not redirect away from the result. Explicit dashboard return links perform a document navigation to request current cards, chart and alerts after a successful write. There is no persisted file/review draft when leaving this page. Navigation confirmation or recovery of an unfinished review is not part of this move. The integration connector, import/revision history browser, and broader dashboard redesign remain separate increments.

Local checks cover account scoping and manual-clear exclusion, authorization before data reads, unavailable/empty states, coverage gaps, date-versus-import distinction, and chart/page navigation. Preview validation must exercise sidebar entry, return navigation after import/clear, Cancel, stale reviews, onboarding, narrow layouts and keyboard access. No production financial data was accessed during development.

### Upload review hierarchy and safeguards

The review card now uses a compact summary and severity hierarchy: date range and "X months ready to import", filename, and three always-visible add/update/remove counts (including zeros). Red callouts identify Replace all, saved-month removal, and existing-month overwrite/blank-field/expense-breakdown effects. Amber callouts identify missing unsaved months, stopped parsing, skipped financial rows, missing optional columns, future months and zero-value checks. Saved internal months retained by Update months use an informational callout. Consequential notices remain outside collapsed details, with explicit category text and Lucide icons as well as CSS-variable colours; callout body text uses the normal ink colour. Exact month lists live under the keyboard-operable native "View month details" disclosure. Routine settings, older-data and dashboard-window notes live under "Additional import information". The latest resulting month, applicable latest-cash correction warning, settings preservation, confirmation/cancel actions, and no-change-before-confirmation statement remain visible. Additions-only uploads omit the existing-month overwrite callout.

`lib/importNotices.ts` defines serializable notices (`code`, `category`, `title`, `message`), shared by parser/review/UI. The parser annotates its warnings at their source, while retaining the legacy string warning array. `buildImportReview` categorizes internal missing-month outcomes and known routine settings notes; unknown strings default to visible warnings. Review responses include optional validated notice metadata for compatibility with older clients/responses; the UI displays unrepresented string warnings conservatively rather than dropping them. Stopped-reading wording now says "X months ready to import" and asks the user to check for later financial rows. Parsing stop/skip rules, validation, database writes, auth, token claims and confirmation behavior are unchanged. No new SQL migration is needed. Local tests verify severity/order, disclosure placement, counts, escaping, unknown-warning fallback, notice-shape validation and real workbook stopped-reading metadata; mounted browser/layout validation remains a preview check.

Internal missing-month notices are now included in the existing review warnings, before confirmation, in both dashboard and onboarding. They identify absent calendar months strictly between the earliest/latest parsed months, distinguish saved months kept by Update months from saved months deleted by Replace all and months with no saved data, and explicitly allow continuing or cancelling to correct the workbook. Consecutive dates are compressed into named month/year ranges; no twelve-month minimum or padding with zero is introduced. A single-month correction, contiguous partial year, or months outside the file's range do not generate internal-gap warnings. Existing Replace all removal lists still cover saved months outside that range. All-empty required financial rows remain skipped with the parser's existing warning; partially blank rows still replace supplied months with NULL for blank fields. These are review-only messages: no parser, token, database function, financial calculation, or write semantics changed, and no new SQL migration is required.

Selecting a workbook in the dashboard or onboarding now prepares a review; it does not import data or complete onboarding. The shared review card displays filename and uploaded date range; exact month lists/counts for additions, updates and removals; older-data messaging relative to the account's latest stored month; the resulting latest month; and a labeled Add/Update/Import/Replace action with Cancel. Replace all highlights omitted saved months that will be removed. Uploaded existing months are complete replacements, including blanks. Business details and thresholds retain their existing preservation rules, and both modes retain the complete prior dataset within the established 20-revision limit. Cancel discards the browser-held file/token without an import request or database write.

The dashboard and upload review now use the **latest twelve stored months**, expanded from the previous six-month dashboard. `DASHBOARD_MONTH_LIMIT` centralizes the page query, helper default, chart slice, review calculation and display. Fewer than twelve records are shown as available, without padding financial values with zero. The chart shows the actual first/last month and year, the stored-month count, and a notice when calendar months within that range are absent. This is a stored-month count, not a guarantee of twelve consecutive calendar months; the enhanced Revenue vs Expenses chart represents gaps using NULL markers on a calendar-spaced axis, as described above. Current cash still comes from the latest record, burn and runway retain their three-record rolling average, and month-over-month metrics/alerts compare the latest two records only when they are consecutive calendar months. Older displayed records do not expand those calculation windows.

The review explains that uploaded months outside this twelve-record dashboard window remain retained, while historical browsing and forecasting are not yet available. No historical-view selector or forecast behavior is introduced. Adding older months does not change the latest month; correcting the latest month can change its cash value, and full replacement can move the latest month backward. The review states these effects rather than universally promising the latest cash position is unchanged.

`POST /api/import/review` and `POST /api/import/confirm` delegate to `lib/financialImportHandler.ts`. Both require a validated Auth user, confirmed email and active subscription before reading the upload. Shared workbook validation rejects invalid forms, modes, duplicate dates and invalid/non-finite financial values. The review endpoint calls only `financial_import_review_state(uuid)`, a server-only STABLE SQL read returning all current month keys plus a fingerprint of complete financial/category rows and the opaque profile data_version. It does not create a business profile, financial rows, revision, or import audit, including on review failure. One SQL statement provides coherent state; UTC/ISO function settings normalize timestamp/date rendering so fingerprints do not depend on the connection timezone. The fingerprint detects changes and is not an authentication credential.

Reviews use a stateless, 15-minute token signed with a domain-separated HMAC-SHA256 key derived from the existing server-only Supabase service-role key. No new environment variable is needed and no key values are logged or returned. Versioned claims bind validated account ID, exact SHA256 file-byte digest, filename, import mode, reviewed state fingerprint and expiration. The token contains no financial rows or API key; it is authenticated, not encrypted. The client keeps the original File and token in component-scoped memory only, with no local/session storage, server draft table or original-file persistence. Confirmation resends the same file and token; the server reauthenticates, rechecks subscription access, validates signature/identity/expiry and reparses the workbook. Wrong-account/mode/file/name, repeated or missing token fields, invalid signatures and expired reviews return 409 before financial RPC work; access checks still run first. Key rotation invalidates outstanding reviews and requires preparing them again. Future parser/claim semantics changes must version the review-token contract.

`docs/migrations/2026-10-24-reviewed-financial-import.sql` adds `financial_import_review_state(uuid)` and `import_reviewed_financial_data(uuid,jsonb,jsonb,text,text,text)`, both SECURITY INVOKER with empty search paths and service-role-only execution. The commit RPC creates/locks the same profile row as imports/clear, recomputes the current fingerprint in a separate SQL statement after acquiring that lock, and raises P0001/import_review_stale if it differs from the signed reviewed state. Only then does it delegate to the existing mode-aware engine within the same transaction. Uploads/clears from other tabs serialize on that lock. Stale confirmation returns 409 IMPORT_REVIEW_STALE with fresh-review guidance and no import-error audit write. Settings-only edits do not invalidate a review; the import preserves the latest preferences. Sequential duplicate confirmations from one review are stale after the first commit, rather than silently importing again. This is not a general exactly-once response cache: losing a committed HTTP response still requires refreshing before reviewing again. Prior direct table edits are fingerprinted, but concurrent writers that bypass the shared profile lock are outside this protocol.

The old immediate-write HTTP endpoints `/api/import` and `/api/import/modes` now return 409 IMPORT_REVIEW_REQUIRED after existing access checks without parsing or importing. This prevents stale clients bypassing the review step after deployment. The new paths also fail safely against older deployments, with no legacy endpoint/RPC retry. Database legacy wrappers remain server-only for compatibility with existing SQL verifiers; trusted server calls can still invoke them directly. Neither review tokens nor SQL fingerprints replace Auth, RLS or service-role access controls. The new DB helpers strictly validate state/result acknowledgments and fail if the migration is missing. Malformed/legacy JSON, HTML errors, mode mismatches, cancellation, duplicate clicks and unknown confirmation outcomes cannot trigger an automatic import retry.

The review card uses labeled month groups, contextual actions, CSS variables, React-escaped user content and focus on its heading. Preparing and confirming have separate announced loading states; per-uploader synchronous guards prevent overlapping operations before React rerenders. Onboarding's imported/completion callback runs only after confirmed success, not after preparation. Confirmation errors discard the prepared file/token and require selecting/reviewing again; a server/network error after commit may still leave a successful import, so refresh-before-retry guidance remains. No changes are made to Stripe, subscriptions, Founding identity, alert calculations or financial values during preparation. Existing financial formulas are unchanged; only the chart's existing slice limit now uses the shared constant.

Deployment: apply the reviewed-import migration in preview after import modes and preserving-settings-on-clear. Run the complete `verify-reviewed-financial-import.sql` as postgres with `preview_confirmed := true` and two distinct dedicated preview UUIDs, through its final ROLLBACK. It checks read-only review for existing/missing profiles, service/browser grants, coherent month keys, timezone-independent fingerprints, first upload with null version, changed settings preserved during review, historical addition, duplicate/stale confirmation, detection of direct month/category edits, Clear Data between review and confirm, exact late-audit rollback in both modes, and account/billing isolation. If it fails, run ROLLBACK before retrying. Never run this verifier in production. Use two preview SQL sessions and the existing profile-row lock_timeout procedure to verify actual waiting; local mocks and sequential verifier checks do not prove contention. Direct-edit detection and expiry/forgery tests complement, rather than replace, SQL locking verification.

Then deploy to preview and validate dashboard/onboarding review, Cancel without changes, overlapping/historical/full-replacement summaries, preservation of settings, duplicate clicks, and stale review after another tab imports or clears. No mutation should occur before the labeled confirmation. Apply only the migration to production before promoting the application. Local tests cover summary effects, signed-token identity/tampering/expiry/key rotation, route authorization/validation/read-only behavior, stale errors, request ordering/cancellation, duplicate guards, unknown responses, and rendered accessible/escaped messaging. PostgreSQL and hosted browser validation remain pending; no production services were accessed. Historical browsing, self-service revision restoration, original-file storage, forecast/reporting promises and broader cleanup work are separate future increments.

### Future accounting integrations: agreed design direction (not implemented)

QuickBooks remains a feature-gated 501 placeholder. The following rules guide its eventual implementation and future provider adapters; they are not current connector capabilities or new database fields:

- Normalize each provider into the shared monthly financial model through a provider adapter. Define cash account inclusion, revenue/expense mapping, reporting currency, cash/accrual basis and calendar/timezone boundaries before publishing comparable figures. Do not silently mix incompatible bases/currencies or combine overlapping spreadsheet/provider totals.
- Begin with one authoritative source per month. Review the connected company, initial date coverage, accounting basis and any overlapping saved months on initial connection. Require an explicit source-switch decision for overlaps; routine authorized syncs can run automatically thereafter with status/exception messaging.
- Distinguish confirmed no activity, data not received, partial data, and failed retrieval. Missing/failed retrieval is not zero and must not clear last-successful values. A provider's omission alone does not prove no activity. Track provenance, source company/connection, freshness and completeness at the appropriate period/field granularity.
- Bind every connection, provider company and background job to the verified owning account. Store credentials only on the server, enforce connection ownership on callbacks/jobs and recheck entitlement before synchronization. Disconnect stops future sync while retaining saved data. Clear Data must pause/invalidate in-flight and scheduled syncs so queued work cannot repopulate a cleared account.
- Fetch/validate outside database transactions, then publish a validated, coherently scoped dataset atomically using the existing account serialization principle. Keep the last successful dataset on fetch/validation failure; never run Replace all against an incomplete response. Queue notification processing, make retries idempotent, prevent older results from replacing newer state, and reconcile missed events. Intuit recommends asynchronous processing and reconciliation: https://static.developer.intuit.com/output_html/qbo/docs/develop/webhooks/best-practices.html .
- Support source corrections/deletions to earlier periods through explicit reconciliation, provenance and revisions. Before implementation, choose initial backfill, routine lookback, longer reconciliation cadence, material-change thresholds and treatment of partial/current months; do not imply earlier periods are immutable.
- Unchanged automated syncs should not consume revisions. Define automated revision retention separately before enabling scheduled sync: the current newest-20 operations policy is for manual imports and would rotate quickly under daily updates. Twelve-month dashboard coverage is independent of data retention and initial sync history.
- Preserve current KPI behavior in the missing-month increment: burn/runway average the latest three stored records, not necessarily consecutive calendar months. Define minimum completeness and gap handling separately before forecasting or stricter calendar-based comparisons.

Implement missing-month upload messaging first; specify the connection/source/completeness contract before connector schema and sync jobs. Historical browsing, forecasting and source overrides remain separate features.

### Preserve settings when clearing financial data

Clear Data removes the financial dataset and its retained revisions, not account preferences. `docs/migrations/2026-10-24-preserve-settings-on-financial-clear.sql` installs `public.clear_financial_data_preserving_settings(uuid)` with the existing profile-row lock, server-only SECURITY INVOKER access, empty search path, account scoping, dependent-first deletes, version stamp, and final manual-clear success audit. The only profile assignment is `data_version = clock_timestamp()`; automatic `updated_at` handling can still run. All five thresholds, business details, onboarding state, and other account preferences remain untouched. Null reserve stays null, explicit zero stays zero, and positive/fractional settings remain exact. The version still advances so data-reload snoozes expire. A purge/delete/profile/audit error rolls back the complete operation, including history deletion.

The existing `clear_financial_data(uuid)` signature now delegates to the preserving function with the same `{cleared:true}` response, so already-deployed code also adopts the policy when SQL commits. The updated `lib/db.ts:clearFinancialData()` calls the explicit preserving function; a missing migration fails closed rather than invoking an older implementation that resets settings. API Auth/email/subscription checks, account isolation, and safe error responses remain unchanged. The confirmation states that financial data and saved financial history are permanently deleted while account details and thresholds are kept. Installing this migration does not clear any account, restore settings previously reset, change imports, or recreate deleted history. An account without a profile still gets database defaults when the stable lock row is first created.

Apply the migration in preview after financial revision history, then run the complete `verify-preserve-settings-on-financial-clear.sql`. Its end-to-end reimport checks require the import-modes migration too. Set `preview_confirmed := true` and two distinct dedicated preview UUIDs; run as postgres through the final ROLLBACK. Never run the verifier in production. It checks positive/fractional, zero, and null reserves; preservation of the full profile except version/modification timestamp; non-default other thresholds; financial/category/history deletion; success auditing; version change; cross-account/billing preservation; new and legacy function behavior; repeated clears; both reimport modes; denied browser grants; and forced purge/late-audit rollback. Existing atomic-clear and revision-history verifiers now assert settings preservation rather than defaults and require this migration for their current-policy checks. They remain preview-only.

After preview SQL passes, deploy the UI/API change to preview and save custom thresholds, reload to confirm persistence, clear a dedicated account, reload Settings, and reimport in each mode. All saved settings must remain exact throughout; current data and prior revisions must disappear on the clear. Apply only the migration in production before promoting the app. Local API/adapter tests validate calls to the preserving RPC, authorization, acknowledgments and no legacy fallback; they mock PostgreSQL and do not prove live preservation or rollback. SQL and hosted checks remain pending. No production services were accessed. Do not reapply older clear/revision function migrations after this one, since they can replace the legacy wrapper with the old reset behavior.

### Atomic clearing of financial data

`DELETE /api/data` requires a valid Auth session, confirmed email, and eligible paid subscription before creating a service client. The validated user ID is passed to `lib/db.ts:clearFinancialData()`, which invokes `public.clear_financial_data(uuid)` once; request-supplied account IDs are ignored. A missing RPC or any database failure produces an error without falling back to separate writes. Error responses carry a request ID without database details. The UI asks users to refresh before retrying if a response is lost and the committed outcome is unknown.

The clear RPC is `SECURITY INVOKER`, uses an empty search path and explicit public tables, and grants execution only to `service_role`. It creates/locks the same account profile row used by imports, purges retained revisions after the financial-revision-history migration, deletes expense categories before financial months, preserves all five account thresholds after the preserve-settings-on-financial-clear migration, advances `data_version` to invalidate data-reload snoozes, and records the existing manual-clear success audit in one transaction. A database exception rolls back all these changes. Business identity, onboarding, snooze preference, subscriptions, Founding identity, and actions are not cleared. A profile is created if absent so an empty account also has a stable lock row. Repeating a clear leaves an empty dataset but records another success audit; this is not exactly-once request processing. When an import races a clear, whichever obtains the lock second completes last; the complete dataset reflects that order.

Apply `docs/migrations/2026-10-23-atomic-financial-clear.sql` after the atomic import migration, first in preview. Run the complete `docs/migrations/verify-atomic-financial-clear.sql` with two dedicated preview account UUIDs, including its final ROLLBACK. The script checks a forced late audit failure, rollback, success, execution privileges, account/billing preservation, unchanged unrelated profile fields, repeated clears, and reimporting. It must never be run in production, even against production test accounts. Only the migration is required for production, before deploying the route.

Automated tests exercise API authorization, account scoping, RPC failures, and acknowledgement validation with mocked database calls. They do not prove PostgreSQL rollback, grants, schema compatibility, or concurrency. The SQL script covers rollback and sequential operation ordering; actual contention requires two preview database sessions. In session A, BEGIN and SELECT the test account's business profile FOR UPDATE. In session B, BEGIN, set a short LOCAL lock_timeout, then call clear_financial_data for that account; it should fail with lock timeout. ROLLBACK session B and repeat with replace_financial_import while A still holds the lock; it must also time out. Finish with ROLLBACK in both sessions. Use dedicated test accounts and do not COMMIT these probes. No concurrency or SQL verification has been run by the agent.

### Subscription initialization and concurrent checkout

`lib/db.ts:getSubscription()` initializes a missing subscription as Starter using `ON CONFLICT (user_id) DO NOTHING` (`ignoreDuplicates: true`). If a checkout webhook or another request creates the row after the initial read, initialization never overwrites its plan, feature tier, status, Stripe identifiers, or Founding identity. After initialization, the helper rereads the account-scoped stored row rather than returning assumed Starter values. Existing rows require only the original read.

Read and initialization errors propagate to callers; an unreadable or missing row after initialization is an error, not an inferred active subscription. The existing unique constraint on `subscriptions.user_id` provides conflict detection; no migration or RLS change is required. A default Starter row alone remains insufficient for paid access under `hasPaidSubscription()`. Founding cancellation, reinstatement, permanent member identity, and Stripe webhook behavior are unchanged.

Regression tests model a webhook arriving between read and insert, including Core, pending-cancellation Founding, and cancelled/suspended Founding rows; they also cover simultaneous initialization, account isolation, and database failures. These tests use an in-memory database double and do not establish that this race previously occurred in a deployed database. No production records were inspected or repaired.

### Stripe webhook status and cancellation rules

The `subscriptions.status` CHECK permits `active`, `cancelled`, `past_due`, `trialing`, `paused`, and `pending_cancellation`. Stripe's billing statuses are a separate domain. `lib/subscriptionStatus.ts` normalizes every checkout-completion, subscription-update, and invoice-state write:

| Stripe subscription state | Application status | Reason |
|---|---|---|
| `active`, no cancellation scheduled | `active` | Current subscription is active. |
| `active`, `cancel_at` or `cancel_at_period_end` set | `pending_cancellation` | Access continues until the effective end; self-service can clear the scheduled cancellation. |
| `trialing` | `trialing` | Preserve the trial state; do not turn a scheduled trial cancellation into paid access. Trial access policy remains separate. |
| `past_due`, `unpaid`, `incomplete` | `past_due` | Billing needs resolution. These states do not qualify as paid access in `hasPaidSubscription`. Stripe retains the original billing state. |
| `paused` | `paused` | Pausing does not mean cancellation or successful payment. |
| `canceled`, `incomplete_expired` | `cancelled` | Terminal state; run cancellation cleanup rather than treating cleared flags as reactivation. |

Unknown Stripe statuses fail processing with 500 rather than writing an unsupported CHECK value or assuming active access. No status-constraint migration is required for this mapping.

**Event identity and ordering.** Subscription and invoice processing matches both `stripe_customer_id` and `stripe_subscription_id`; matching only the customer would allow an old subscription event to cancel its replacement. An already-cancelled row cannot be revived by nonterminal updates or invoice events for that same subscription. New subscriptions enter through the coordinated checkout or explicitly support-approved reinstatement path.

Both invoice success and failure handlers retrieve the current Stripe subscription before updating the application. An old paid invoice cannot activate a currently paused, unpaid, incomplete, or ended subscription. An old failed invoice cannot downgrade a recovered active subscription or remove a valid scheduled cancellation. Invoice writes also compare the previously read application status and both Stripe IDs, avoiding overwriting a cancellation/replacement that happened during the lookup. Stripe lookup and database failures return 500 for retry; missing period dates are left unchanged rather than replaced with the Unix epoch.

**Terminal cancellation.** `customer.subscription.deleted`, terminal `customer.subscription.updated` states, and terminal states discovered during invoice processing share one cleanup function. The current Founding plan retains `plan=founding_member`, uses `feature_tier=suspended`, and keeps its member number/test flag. Standard plans reset to Starter while retaining any historical Founding number; a permanent badge alone does not establish the current plan. Only the matching subscription row is updated; the issued-spot registry is untouched.

Use Stripe `ended_at` for `cancelled_at` and `billing_period_end`; for Founding plans also set `founding_member_cancelled_at` and clear the obsolete grace deadline. If `ended_at` is missing, preserve a previously recorded effective cancellation time or fall back to the signed event's creation time. Immediate cancellation ends access immediately even when the originally purchased period had a later end. Self-service reinstatement requires a pending cancellation before the effective end; after ending, support reviews reinstatement case by case. There is no post-end self-service grace window.

Scheduled cancellations already send their notice. Sequential duplicate/updated/deleted terminal events suppress another notice once cancellation is recorded. This is not a durable event ledger or an exactly-once email guarantee; simultaneous delivery, email failures, and general nonterminal event ordering are separate concerns. Invoice current-state reconciliation does not make every subscription-update event globally ordered.

**Investigation, 23 October 2026.** Preview test member #26 had the correct Founding plan, cancelled status, suspended tier, test registry identity, and effective end matching Stripe. Its existing `cancelled_at` was 1.169 seconds later than the effective end. That discrepancy was observed, not attributed to a confirmed cause or backfilled. `suspended` was introduced on 4 June 2026 and is permitted by the validated preview feature-tier CHECK; replacing it globally with Starter would change access semantics. No bulk plan rewrite is appropriate merely because an account retains a member number.

### Founding membership administration

Apply `docs/migrations/2026-10-22-founding-billing-cycle-reinstatement.sql` in preview before running the updated application. It supersedes the earlier 30-day migration, whether or not that migration was applied. Existing assignments remain customer assignments until explicitly corrected; the migration does not infer test status or move any accounts automatically. Existing customer numbers outside #1-#25 cause validation to fail for review rather than being silently reclassified.

Run corrections manually through the Supabase SQL editor as `postgres`. Browser users and `service_role` cannot execute this operation. Each correction requires the account UUID, desired number (or NULL), explicit test designation, reason, and administrator name. The audit also records the database session identity and previous/new membership identity. The name is an operator-supplied label; database access logs remain the source for identifying the person using a shared SQL-editor role.

To move a test account from customer #1 to test #26, replace the placeholders and run:

```sql
SELECT public.admin_correct_founding_membership(
  '<account-uuid>'::uuid, 26, true,
  'Move test account out of the customer pool', '<administrator-name>'
);
```

This releases #1 and assigns #26 in one transaction, provided #26 is available. The next paying customer receives the lowest unissued customer number. A cancelled paying customer's number stays issued and is never selected by ordinary allocation.

To clear a mistaken assignment, use `NULL, false`. To assign a customer identity manually, use a number from 1 through 25 and `false`. Other test accounts need distinct numbers above 25. All operations reject numbers owned by another account and roll back the entire correction on a collision. Clearing a deleted account's retained registry identity is also supported by UUID.

Corrections update **identity only**. They do not create/cancel Stripe subscriptions, charge/refund money, change plans/status/features, or reactivate subscriptions. Keep any test entitlement configuration separate. Close outstanding checkout sessions and reconcile in-flight billing events before resetting an account's identity so an old payment cannot issue another claim afterward.

Verify in preview using `docs/migrations/verify-founding-membership-corrections.sql`. Fill in two dedicated preview account UUIDs and run the entire script as `postgres`; it rolls back fixture changes. It covers role permissions, forged bypass flags, test exclusion, assignment, cancellation retention, collisions, number ranges, release, and append-only auditing. Multi-connection checkout concurrency and browser/Stripe integration still require preview verification. Do not treat the verification file as a migration.

## 10 Document History

| Version | Date | Changes |
|---|---|---|
| 1.0 | April 2026 | Initial version — brand tokens, empty states, component patterns, standing rules |
| 1.1 | April 2026 | Action Tracker additions — status badges, action list, create modal, recommendations widget |
| 1.2 | June 2026 | Billing components — UpgradeModal, UpgradeStrip, FoundingMemberBadge, PendingCancellationBanner, suspended state, plan badges. Settings patterns — ThresholdsCard saved/previous indicators, AlertPreferencesCard, ChangePasswordCard. Launch config pattern. Alert dismiss/snooze pattern. Sidebar updates — Scenarios hidden, Reports gated. Architectural decisions table. Removed grace period components (manual CS process). |
