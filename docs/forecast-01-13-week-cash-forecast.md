# FORECAST-01 — rolling 13-week cash forecast

**Status:** FORECAST-01A product and data contract drafted 25 October 2026; implementation not started  
**Audience:** Small and medium business owners, professional CFO/CPA users and Elidan advisors  
**Depends on:** [CFO capability roadmap](cfo-capability-roadmap.md), [financial data contract v2](financial-data-contract-v2.md), [normalized cash engine](fin-03-normalized-engine.md)

## Outcome

Elidan will answer a practical owner question: **“Do I have enough cash to meet the obligations I expect over the next 13 weeks, and what should I address first?”**

The forecast is a direct cash model. It starts with an actual cash balance, places expected receipts and payments into weeks based on expected cash dates, and produces weekly ending cash. It does not infer a profit-and-loss forecast from monthly totals or present an accounting projection as bank liquidity.

The experience must remain usable for an owner who is not financially trained. The default view emphasizes expected cash, the lowest projected balance, the first week below the owner's minimum reserve and the largest uncertain items. Detailed categories, assumptions and evidence remain available for review.

## Product boundaries

FORECAST-01 covers:

- one business and reporting currency per forecast;
- thirteen consecutive weekly periods;
- actual starting available cash at an explicit as-of date;
- expected customer receipts and operating payments;
- payroll, tax, debt, owner, investing, funding and other cash movements kept distinct;
- named assumptions and confidence for estimated items;
- base, downside and upside cases derived from a common forecast version;
- immutable published versions and draft revisions;
- actual-versus-forecast variance after a week closes;
- evidence links back to manual entries, spreadsheet imports or provider records;
- actions created from a specific forecast risk or assumption.

FORECAST-01 does not include multi-entity consolidation, foreign-exchange conversion, inventory purchasing models, project profitability, debt covenant calculations, tax advice or automatic financing recommendations. These require separate contracts and qualified-professional boundaries.

## Tier behavior

All tiers receive accurate calculations and material warnings for data they are permitted to use.

| Capability | Starter | Core | Growth | Advisory / professional service |
| --- | --- | --- | --- | --- |
| Existing scenario tool | One unsaved monthly operating scenario | Included | Included | Included |
| 13-week forecast | Read-only introduction and upgrade context | One saved base forecast with manual weekly items and rolling update | Versioned base/downside/upside cases, imports/integrations, variance and comparison | CFO-created assumptions, review, commentary and sign-off |
| Collaboration | Owner actions | Owner workflow | Team review and approval after ORG-01 | Assigned professional workflow after ORG-01/ADV-01 |

Core must be useful without QuickBooks. Growth adds depth, retained alternatives, automation and analysis; it does not make the Core arithmetic less accurate.

## Forecast calculation

For week `w`:

`ending cash(w) = beginning cash(w) + cash receipts(w) − cash payments(w)`

For each week after the first:

`beginning cash(w) = ending cash(w − 1)`

Available cash is the amount available for ordinary obligations. Restricted, reserved or otherwise unavailable balances remain separately visible and do not increase available cash.

Each line item has a nonnegative amount and a direction (`inflow` or `outflow`). Categories determine presentation and analysis; they do not change the sign rule. Moving an item to a different week changes timing without changing its amount. A scenario adjustment must state whether it changes timing, amount or probability.

The forecast reports:

- weekly beginning cash, inflows, outflows and ending cash;
- lowest projected cash and its week;
- first week below the minimum reserve, if any;
- cumulative 13-week operating surplus or shortfall;
- receipts and payments by category;
- overdue or unscheduled items excluded from weekly totals;
- forecast coverage, freshness and unresolved-data counts.

## Required records

### Forecast

A forecast belongs to one account workspace and records:

- stable forecast ID, owner and reporting currency;
- start date, as-of date and thirteen weekly boundaries;
- actual starting included cash and unavailable cash;
- minimum reserve used for the analysis;
- status: `draft`, `published`, `superseded` or `archived`;
- source data version and formula-policy version;
- created, published and superseded timestamps and actors.

### Forecast version

Publishing creates an immutable version. Editing a published forecast creates a new draft. A version records its parent, case (`base`, `downside`, `upside`), assumptions, calculation result and source snapshot. Historical results must remain reproducible even after financial data or provider records change.

### Cash item

Each expected cash item records:

- description, amount, direction and cash category;
- expected cash date and resulting forecast week;
- source type and source reference;
- status: `expected`, `confirmed`, `paid`, `received`, `cancelled` or `excluded`;
- confidence: `confirmed`, `high`, `medium`, `low` or `unknown`;
- recurrence details when generated from a schedule;
- counterparty or descriptive label where available;
- whether the date or amount is an estimate;
- created/updated actor and timestamps.

Initial categories are customer receipts, operating vendor payments, payroll, taxes, debt principal, debt interest, owner distributions, asset purchases, asset proceeds, new debt, owner/equity funding and other cash in/out. These align with contract v2 instead of collapsing non-operating activity into operations.

### Assumption

An assumption is explicit and evidence-linked. Examples include “collect 80% of invoices in their expected week,” “delay discretionary purchase by two weeks” or “reduce uncommitted receipts by 25%.” It records the affected items, operation, value, rationale, creator and case. Assumptions never overwrite source records.

### Actual and variance

When a week closes, actual cash activity is matched or mapped to forecast items. Variance separates:

- amount variance;
- timing variance;
- new/unplanned cash activity;
- cancelled or missed items;
- unresolved matching differences.

The system must not call an unmatched value a performance variance until the user or a deterministic rule confirms the mapping.

## Input paths

### Manual/Core path

The owner enters or reviews:

1. starting available cash and as-of date;
2. expected customer receipts;
3. bills and operating payments;
4. payroll, taxes and debt payments;
5. known funding, investing or owner cash movements;
6. the minimum cash reserve;
7. uncertain dates or amounts.

Recurring schedules can generate draft weekly items, but every generated item retains its schedule source and remains reviewable.

### Spreadsheet path

A dedicated forecast workbook may provide line-item dates and amounts. The monthly financial template will not be expanded into a 13-week forecasting workbook because actual history and forward commitments serve different purposes. Upload uses review-before-confirmation, strict limits, idempotent publication and source lineage consistent with financial imports.

### Integration path

QuickBooks or another provider can supply open invoices, bills, payment terms, actual transactions and balances. Provider due dates are evidence, not guaranteed cash dates. Elidan preserves provider identity and sync state, allows a user-confirmed expected date, and does not silently convert overdue items into current-week cash.

## Owner experience

The primary forecast page contains:

1. a compact status header with as-of date, starting available cash, coverage and freshness;
2. a 13-week cash curve with the minimum reserve shown as a labelled threshold;
3. owner-friendly findings: lowest cash week, reserve breach, largest expected receipt/payment and unresolved items;
4. a weekly table that exposes the exact chart values;
5. an item list grouped by week with filters for inflow/outflow, category, confidence and source;
6. assumptions and scenario comparison when the tier permits it;
7. publish/version and action controls.

Missing information stays visible. Empty weeks are not treated as zero activity unless the user or provider confirms zero. Unscheduled and overdue items remain in a review queue rather than disappearing from the forecast.

## Accuracy and safety rules

- Material calculations are deterministic and independently tested.
- Starting cash, weekly items, assumptions and results retain source lineage.
- Actual, estimated, confirmed-zero and missing values remain distinct.
- A forecast is labelled stale when its starting balance or critical source data is outdated.
- Low-confidence receipts do not become guaranteed liquidity in customer-facing language.
- Financing receipts never improve operating performance metrics.
- Published versions are immutable; corrections create a new version.
- AI may explain results or suggest questions only after calculations exist and must cite the forecast version and assumptions.
- Actions retain the forecast version and triggering item or finding.
- Clear Data, account deletion and provider disconnect behavior must be explicitly defined before implementation.

## FORECAST-01 increments

### FORECAST-01A — product and data contract

Approve the direct-cash method, tier boundaries, weekly categories, record lifecycle, missing-data behavior, spreadsheet separation and actual-versus-plan model. No application or database behavior changes.

### FORECAST-01B — deterministic engine

Implement a pure calculation library for weekly roll-forward, reserve thresholds, cases, coverage, freshness and variance classification. Use independently prepared fixtures and property tests. No UI or database dependency.

### FORECAST-01C — account-scoped storage

Add forecasts, immutable versions, cash items, schedules, assumptions and source lineage with least-privilege policies and atomic publish/version operations. Include rollback and two-session concurrency verification.

### FORECAST-01D — Core manual workflow

Build the accessible 13-week page, manual item workflow, base forecast, exact-value table, review queue and forecast-to-action handoff. Add a dedicated forecast spreadsheet only if manual testing proves it reduces owner effort.

### FORECAST-01E — Growth cases and variance

Add retained downside/upside cases, version comparison, weekly actual matching and variance explanations. QuickBooks ingestion remains INT-01 and publishes through the same normalized records.

## Open release decisions

Before FORECAST-01C, approve:

- whether Core includes one active published forecast or an unlimited rolling history with one active case;
- the exact freshness thresholds for starting cash, invoices, bills and manually entered items;
- whether minimum reserve defaults from Settings or is version-specific with a Settings suggestion;
- forecast retention after plan downgrade, Clear Data and account deletion;
- which forecast records an advisor may edit versus comment on after ORG-01/ADV-01;
- launch wording and disclosures through LEGAL-01;
- replacement of current “12-month cash flow forecast” marketing copy with the approved 13-week capability and any later long-range planning label.

