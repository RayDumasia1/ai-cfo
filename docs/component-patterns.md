# Elidan AI — Component Patterns

Reference for all UI components in this project. Follow these patterns exactly when
building new components. Do not deviate without updating this file first.

---

## Brand Tokens

All tokens are CSS custom properties defined in `app/globals.css` and mapped into
Tailwind v4's `@theme inline` block. Always use the variable names — never hardcode
the hex values except where CSS variables are not available (e.g. inside inline style
objects that need a literal colour for a third-party library like Recharts).

### Colour palette

| Token | Hex | Usage |
|---|---|---|
| `--navy` | `#0A1A2F` | Primary dark — page headings, card titles |
| `--teal` | `#2CA6A4` | Brand accent — CTA buttons, links, positive indicators, success borders |
| `--cloud` | `#F4F7FA` | Page background |
| `--ink` | `#344150` | Body text, card values |
| `--gold` | `#D4AF7F` | Secondary accent — cash-out date card border, neutral highlights |
| `--line` | `#D8E2EC` | Borders, dividers, skeleton/placeholder icon colour |
| `--dim` | `#6B7A8D` | Muted text — labels, sub-labels, empty state copy, legend text |
| `--surface` | `#FFFFFF` | Card backgrounds |

Semantic colours (not tokenised, use hex directly):

| Purpose | Hex |
|---|---|
| Danger / high risk | `#ef4444` |
| Warning / medium risk | `#f59e0b` |
| Healthy / positive | `#22c55e` |
| Danger red (chart) | `#E84545` |

### Radius

| Token | Value | Usage |
|---|---|---|
| `--radius-sm` | `6px` | Buttons, small chips |
| `--radius-md` | `10px` | Stat cards, form inputs |
| `--radius-lg` | `16px` | Chart cards, large surface panels |

### Shadow

| Token | Value | Usage |
|---|---|---|
| `--shadow-sm` | `0 1px 3px rgba(10,26,47,0.08)` | All cards |
| `--shadow-md` | `0 4px 16px rgba(10,26,47,0.10)` | Modals, tooltips |

### Typography

Font: **Inter** (variable font, loaded via `next/font/google`).
Weights in use: 300 (light), 400 (regular), 500 (medium), 600 (semibold).
No bold (700+) is used anywhere — heaviness comes from size, not weight.

| Element | Size | Weight | Colour |
|---|---|---|---|
| Page heading | `text-2xl` (24px) | 500 | `--ink` |
| Section heading | `text-base` (16px) | 500 | `--ink` |
| Card label (uppercase) | 11px | 500 | `--dim`, `letter-spacing: 0.08em` |
| Card value (primary) | 1.65rem | 500 | `--ink` |
| Card sub-label | 12px | 300 | `--dim` |
| Chart title | 13px | 600 | `--navy` |
| Chart sub-label / insight | 12px | 400 | varies by state |
| Body / description | `text-sm` (14px) | 300 | `--ink` or `--dim` |
| Micro text / labels | 11px | 400–500 | `--dim` |

---

## Empty State Pattern

**Standing rule: never hide a component because it has no data.** Always show the
component shell with an empty state inside. Layout must not shift between empty and
populated states — the component must occupy the same space in both cases.

### Stat cards

Stat cards always render. When no data is available:

- Value: `—`
- Sub-label: `"No data imported yet"` (or context-specific equivalent)
- Border colour: `var(--line)` — no risk colour until data exists
- No MoM delta shown

Do not change this behaviour. It is already correctly implemented.

### Chart components

Chart cards always render at full size. When `getXxxChartData()` returns `null`
(zero months of data), render the empty state inside the same card shell:

```tsx
// Shared card shell — same style object for both empty and populated
const CARD_STYLE: React.CSSProperties = {
  backgroundColor: "#FFFFFF",
  border: "1px solid #D8E2EC",
  borderRadius: "var(--radius-lg, 16px)",
  boxShadow: "0 1px 3px rgba(10,26,47,0.08)",
  padding: "24px",
  minHeight: 316,   // pin to populated height to prevent layout shift
};

// Empty state body (inside the card, below the title row)
<div style={{ display:"flex", flexDirection:"column", alignItems:"center",
              justifyContent:"center", flex:1, minHeight:200, gap:12, paddingTop:16 }}>
  <RelevantLucideIcon size={32} color="#D8E2EC" strokeWidth={1.5} />
  <p style={{ fontSize:13, color:"#6B7A8D", textAlign:"center",
              maxWidth:280, margin:0, lineHeight:1.5 }}>
    Upload your financial data to see your [chart description].
  </p>
  <a href="#import-section" onClick={smoothScrollHandler}
     style={{ fontSize:13, color:"#2CA6A4", textDecoration:"none" }}>
    Upload data →
  </a>
</div>
```

Card title in empty state: `"[Chart Name]  ·  No data yet"` — same font/position as
the populated title.

**Minimum card height:** `200px` for the placeholder body area. The outer card
`minHeight` should match the natural height of the populated card so there is no
layout shift on first import.

**Icon selection:** use a Lucide icon semantically related to the chart type.
- Line/trend chart → `TrendingUp`
- Bar chart → `BarChart2`
- Pie/composition chart → `PieChart`
- Table/list → `Table2`

### Alerts panel

The panel always renders. When the alerts array is empty:

```tsx
<p className="text-sm font-light" style={{ color: "var(--dim)" }}>
  ✓ No alerts — all metrics are within healthy ranges.
</p>
```

Never hide the panel. Already correctly implemented in `AlertsPanel.tsx`.

### Tables and lists (future components)

Always render the container. When the list is empty:

```tsx
<div style={{ display:"flex", flexDirection:"column", alignItems:"center",
              justifyContent:"center", minHeight:200, gap:12 }}>
  <RelevantLucideIcon size={32} color="#D8E2EC" strokeWidth={1.5} />
  <p style={{ fontSize:13, color:"#6B7A8D", textAlign:"center", maxWidth:280 }}>
    No [data type] to show yet.
  </p>
  {/* action link if relevant */}
</div>
```

---

## Alert Severity

Defined in `lib/types.ts` as `AlertSeverity = "danger" | "warning" | "success"`.
Produced by `alertEngine()` in `lib/calculations.ts`.

### Colours and icons

| Severity | Left border | Title colour | Icon |
|---|---|---|---|
| `danger` | `#ef4444` | `#ef4444` | `✕` |
| `warning` | `#f59e0b` | `#f59e0b` | `⚠` |
| `success` | `#22c55e` | `#22c55e` | `✓` |

### Sort order

Always render: danger → warning → success (most urgent first).

### Alert codes and trigger conditions

| Code | Severity | Triggers when |
|---|---|---|
| `RUNWAY_DANGER` | danger | `runway < runway_danger_threshold` (default 3 mo) |
| `RUNWAY_WARNING` | warning | `danger_threshold ≤ runway < warning_threshold` (default 6 mo) |
| `BURN_RATE_SPIKE` | warning | MoM expense increase > `burn_rate_warning_pct × 100` (default 10%) |
| `CASH_BELOW_RESERVE` | danger | `closing_cash < min_cash_reserve` |
| `HIGH_AR` | warning | `ar_outstanding > closing_cash` |
| `REVENUE_GROWTH` | success | MoM revenue growth > 5% |

`RUNWAY_DANGER` and `RUNWAY_WARNING` are mutually exclusive — only one fires per render.

---

## Stat Card Anatomy

All stat cards share this visual structure. Implemented individually (no shared
`StatCard` base component — each card owns its full JSX for clarity).

```
┌─────────────────────────────────────┐  ← border: 1px solid [risk colour or --line]
│  LABEL           (11px, uppercase)  │  ← color: --dim
│                                     │
│  Value           (1.65rem, medium)  │  ← color: --ink
│                                     │
│  Sub-label line 1  (12px, light)    │  ← color: --dim or risk colour
│  Sub-label line 2  (12px, light)    │  ← color: semantic (green/red for MoM)
└─────────────────────────────────────┘
  padding: 1.25rem 1.5rem
  border-radius: --radius-md
  box-shadow: --shadow-sm
  background: --surface
```

### Border colour by risk level (RunwayCard)

| Runway | Border |
|---|---|
| > 6 months | `#22c55e` (green) |
| 3–6 months | `#f59e0b` (amber) |
| < 3 months | `#ef4444` (red) |
| No data | `var(--line)` |

### Border colour by cash reserve (CashPositionCard)

| Cash level | Border |
|---|---|
| `cash ≥ min_cash_reserve` | `#22c55e` (green) |
| `cash ≥ min_cash_reserve × 0.8` | `#f59e0b` (amber) |
| `cash < min_cash_reserve × 0.8` | `#ef4444` (red) |
| No reserve set or no data | `var(--line)` |

### MoM delta formatting

```tsx
// Positive (improved) → green ↑
<span style={{ color: "#22c55e" }}>↑ {abs} months vs last month</span>

// Negative (declined) → red ↓
<span style={{ color: "#ef4444" }}>↓ {abs} months vs last month</span>

// No prior month → muted
<span style={{ color: "var(--dim)" }}>— vs last month</span>
```

---

## Chart Card Anatomy (RevenueBurnChart)

```
┌──────────────────────────────────────────────────────┐
│  Chart Name · Period label          (13px, 600)      │
│  Insight line                       (12px, teal/red) │
│                                                      │
│  [Recharts ResponsiveContainer, height=200]          │
│                                                      │
│  ■ Revenue   ■ Burn Rate            (12px, #6B7A8D)  │
└──────────────────────────────────────────────────────┘
  padding: 24px
  border: 1px solid #D8E2EC
  border-radius: --radius-lg (16px)
  box-shadow: --shadow-sm
  background: #FFFFFF
  min-height: 316px
```

### Chart line styles

| Series | Stroke | Fill area | Dot |
|---|---|---|---|
| Revenue | `#2CA6A4` (teal) | `rgba(44,166,164,0.08)` | r=3, filled teal |
| Burn Rate | `#E84545` (red) | `rgba(232,69,69,0.06)` | r=3, filled red |

### Axis styles

- No axis lines (`axisLine={false}`)
- No tick marks (`tickLine={false}`)
- Font: 11px, `#6B7A8D`
- Grid: horizontal only, `#D8E2EC` at 40% opacity
- Y-axis formatter: `$XXK` / `$X.XM`

### Tooltip

Custom component, not Recharts default. White card, `#D8E2EC` border, 8px radius,
`0 2px 8px rgba(10,26,47,0.10)` shadow. Shows "—" for null values instead of $0.

### Period label rules

| Data available | Title suffix |
|---|---|
| 0 months | `· No data yet` |
| 1 month | `· Last month` |
| N months (2–5) | `· Last N months` |
| 6 months | `· Last 6 months` |

---

## Import Flow

Upload states: `idle → uploading → success | error`
Clear states: `idle → confirming → clearing → idle`

### Import strategy: replace, not append

Every upload is a clean slate. The import route (`app/api/import/route.ts`):
1. Counts existing `financial_months` for the user
2. If any exist: deletes all `financial_months` and `expense_categories` first
3. Inserts the new months from the uploaded file
4. Returns `replaced: true | false` so the UI can say "Replaced with" vs "Imported"

### Success message verb

```
replaced === true  → "✓ Replaced with N months of data"
replaced === false → "✓ Imported N months of data"
```

### Clear all data

`DELETE /api/data` — deletes `financial_months`, `expense_categories`, resets
profile financial settings to defaults, logs the action to `data_imports`.

"Clear all financial data" link is shown only when `hasData === true`. It renders
an inline confirmation card (not a browser `confirm()` dialog) before executing.

---

## Architecture Rules

- **Pure functions in `lib/calculations.ts`** — no React, no Supabase, no side effects.
  Every derived metric is a standalone testable function.
- **DB functions in `lib/db.ts`** — all write helpers accept an optional `SupabaseClient`
  parameter (default = browser singleton). Server route handlers always pass the
  authenticated server client so RLS resolves correctly.
- **Server components fetch, client components display** — the dashboard page
  (`app/dashboard/page.tsx`) fetches all data once and passes it down as props.
  No client-side fetching for initial render.
- **No extra DB calls for derived metrics** — all stat cards and the alerts panel
  reuse the `recentMonths` array (6 months, newest-first) fetched once by the
  dashboard server component.
- **`lib/excelParser.ts` is server-only** — `import "server-only"` at the top.
  Never import it in client components or `lib/calculations.ts`.
