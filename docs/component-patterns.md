# Elidan AI — UI Component Patterns & Design System
**Version 1.2 · June 2026 · Internal**

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
- Reset icon restores previous value AND saves to DB (one-click restore)

Value formatting:
- Threshold fields: plain number "Saved: 6"
- Cash reserve: currency "Saved: $25,000"
- Burn rate: percentage "Saved: 10%"

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
- Server-side: re-authenticates with current password before updating
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

`PATCH /api/settings` requires a JSON object containing all four threshold fields as finite JSON numbers: `runway_warning_threshold`, `runway_danger_threshold`, `min_cash_reserve`, and `burn_rate_warning_pct`. It rejects malformed/non-object bodies, missing fields, strings, booleans, arrays, objects, nulls, and overflowing numeric literals with 400 before any profile write. It does not coerce input with Number(). The existing form already submits numeric values.

Warning/danger months and burn percentage must be positive, danger must be strictly less than warning, and cash reserve may be zero but not negative. Fractional months and burn-rate increases above 100% remain valid; no new product maximums were introduced. The percentage sent by the form is converted once to the stored decimal (10 becomes 0.10); an extremely small percentage that underflows to zero is rejected. The schema's nullable cash reserve remains unchanged; this save endpoint requires an explicit number, while the clear-data RPC can still reset the stored reserve to NULL.

Only the four allowed fields are written, using the validated Auth user ID and session client. Extra account IDs, plan fields, and business identity fields cannot change ownership or be mass-assigned through this endpoint. Auth/session and email-verification checks remain enforced by requireAuth, and the existing subscription guard is unchanged. Database failures return a generic 500 message and requestId; server logs record `settings:thresholds:save:error` with that request ID and the authenticated user ID, without raw database details or submitted values. Invalid bodies return 400 rather than an unhandled null-destructuring error.

Route tests reproduced the previous coercion, non-finite-value, underflow, and error-response problems using mocked database calls. Tests cover strict input rejection before writes, allowed ranges, percentage conversion, account scoping/field allowlisting, and Auth boundaries. No live settings or production data were changed. No migration, backfill, billing change, or browser form change is included; existing stored values are not repaired by this validation change.

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

`lib/db.ts:replaceFinancialImport()` calls `public.replace_financial_import(uuid,jsonb,jsonb,text)` once. The RPC creates/locks the account's business profile, applies only workbook-supported profile fields, clears old categories/months, inserts the replacement months, stamps `data_version`, and writes the success audit in one transaction. Database exceptions roll all these changes back. Same-account imports and clears serialize on the same profile row; different accounts use different locks. Direct database writes outside these RPCs are not coordinated by this application protocol.

The function is `SECURITY INVOKER` with an empty search path and explicit public table names. Only `service_role` can execute it; PUBLIC, anon, and authenticated access is revoked. The verified API supplies `p_user_id` from Auth, never request/form/workbook ownership fields. SQL also rejects unexpected payload fields and duplicate/non-month dates. No subscription, Stripe, or Founding identity writes occur during import. Service credentials remain server-side.

Success auditing and the data version are part of the transaction; separate pending/success requests and post-import subscription initialization are removed. Failure auditing remains best effort. Errors sent to the browser include a request ID without raw database details. A lost RPC response can leave commit status unknown, so the UI directs the user to refresh before retrying; this change does not provide exactly-once requests.

Deployment order: apply `docs/migrations/2026-10-23-atomic-financial-import.sql` in preview, then run `docs/migrations/verify-atomic-financial-import.sql` as postgres with two distinct dedicated preview test-account UUIDs, then deploy the app change to preview and test an import/replacement. The verification script uses a forced failure at the final audit write to assert restoration of months, categories, profile, version, and audit history; it also checks account isolation, billing preservation, payload rejection, and execution privileges. Its final ROLLBACK discards all test changes. If it fails, run ROLLBACK before retrying. Do not deploy the route before the migration: a missing RPC returns an error with no destructive fallback.

Automated route/adapter tests mock database calls and include the real Excel fixture parser. They do not execute PostgreSQL or prove live rollback, grants, schema compatibility, or concurrent-lock behavior. Preview SQL and hosted testing are required before promotion. This change does not backfill data from previously failed imports.

### Atomic clearing of financial data

`DELETE /api/data` requires a valid Auth session, confirmed email, and eligible paid subscription before creating a service client. The validated user ID is passed to `lib/db.ts:clearFinancialData()`, which invokes `public.clear_financial_data(uuid)` once; request-supplied account IDs are ignored. A missing RPC or any database failure produces an error without falling back to separate writes. Error responses carry a request ID without database details. The UI asks users to refresh before retrying if a response is lost and the committed outcome is unknown.

The clear RPC is `SECURITY INVOKER`, uses an empty search path and explicit public tables, and grants execution only to `service_role`. It creates/locks the same account profile row used by imports, deletes expense categories before financial months, resets the existing five financial thresholds to their established defaults, advances `data_version` to invalidate data-reload snoozes, and records the existing manual-clear success audit in one transaction. A database exception rolls back all these changes. Business identity, onboarding, snooze preference, subscriptions, Founding identity, and actions are not cleared. A profile is created if absent so an empty account also has a stable lock row. Repeating a clear leaves an empty dataset but records another success audit; this is not exactly-once request processing. When an import races a clear, whichever obtains the lock second completes last; the complete dataset reflects that order.

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
