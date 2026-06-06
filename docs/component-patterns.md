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
- Optimistic UI: alert disappears immediately, restores on API failure
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
- Migrated from localStorage to Supabase
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
- `ask_cfo`, `ai_insights`, `weekly_summary`, `quickbooks_sync`, `xero_sync`
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
| Xero + QuickBooks tier | Both at Core — not split |
| Bank sync | Deferred to Phase 4 |
| Founding Member | Core forever at $49, no 24-month expiry |
| FM cancellation | Manual CS process — no automated grace period |
| FM spots | 25 total issued, never return to pool |
| Suspended state | Simple message + email us — no automated restore |
| Scenarios page | Hidden pending UX review |
| Growth/Advisory | Hidden — coming soon |
| `usage_limit` | Not `limit` — PostgreSQL reserved word |
| One subscription per user | Enforced — updates not new checkouts |
| feature_tier vs plan | Decoupled — feature access independent of billing price |
| `business_id` | Always derived server-side, never trusted from client |
| Stripe webhooks | Always return 200 — log errors, never throw |
| Service role client | Only in webhooks, cron jobs, admin routes |

---

## 10 Document History

| Version | Date | Changes |
|---|---|---|
| 1.0 | April 2026 | Initial version — brand tokens, empty states, component patterns, standing rules |
| 1.1 | April 2026 | Action Tracker additions — status badges, action list, create modal, recommendations widget |
| 1.2 | June 2026 | Billing components — UpgradeModal, UpgradeStrip, FoundingMemberBadge, PendingCancellationBanner, suspended state, plan badges. Settings patterns — ThresholdsCard saved/previous indicators, AlertPreferencesCard, ChangePasswordCard. Launch config pattern. Alert dismiss/snooze pattern. Sidebar updates — Scenarios hidden, Reports gated. Architectural decisions table. Removed grace period components (manual CS process). |
