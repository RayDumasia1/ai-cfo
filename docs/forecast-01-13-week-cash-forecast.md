# FORECAST-01 — rolling 13-week cash forecast

**Status:** FORECAST-01A through FORECAST-01C promoted; FORECAST-01D Core manual workflow implemented locally 25 October 2026
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

### Onboarding and upgrade readiness

Readiness is evidence-based and applies both when an existing customer upgrades and when a new customer starts on Core or higher. A plan selection changes feature access; it does not determine whether the underlying data supports a particular conclusion.

A Starter customer with valid contract-v2 history must be able to use Core Ask CFO and receive initial AI Insights immediately after the subscription change becomes authoritative. The customer is not required to upload the same history again, connect QuickBooks or complete a second financial onboarding flow.

A new Core, Growth or Advisory customer follows the same readiness checks during onboarding. The customer may begin with an Elidan spreadsheet, QuickBooks, banking data, another supported financial provider or an approved combination. The onboarding flow normalizes evidence into shared financial contracts before enabling dependent guidance. No source is treated as inherently complete merely because it is connected.

An account-scoped readiness/context service assembles the strongest evidence already available:

- financial months, contract version and usable consecutive history;
- latest available cash, reserve and normalized operating metrics;
- currency, accounting basis, source, completeness and freshness;
- gaps, confirmed zeroes, partial periods and reconciliation state;
- optional liquidity details, alerts and open actions;
- forecast existence, coverage, source version and unresolved items.

The service returns capability-specific readiness rather than one global ready/not-ready flag. Monthly history can support historical cash-health questions even when a 13-week forecast is unavailable. A forecast question that requires invoice dates, bill dates, payroll or taxes returns a targeted request for only those inputs. Missing QuickBooks access is never itself a reason to block guidance.

At onboarding, the service distinguishes:

- **connection complete:** credentials or a file were accepted;
- **data retrieved:** source records were received;
- **data normalized:** required values were mapped into Elidan's shared contracts;
- **data reconciled:** applicable cash checks passed or unresolved differences are visible;
- **capability ready:** sufficient current evidence exists for a named feature;
- **enrichment needed:** specific missing inputs limit only identified questions or analyses.

These states prevent a successful bank or accounting connection from being presented as financially complete. Banking may provide strong cash evidence while lacking invoice, bill, category or commitment context. Accounting data may provide invoices and bills while its bank balance or sync is stale. Spreadsheet customers receive the same calculation and completeness standards after server-side validation.

Supported context levels are:

| Available evidence | Supported guidance |
| --- | --- |
| Valid monthly history | Historical cash health, trends, anomalies, buffer/runway and bounded monthly scenarios |
| Monthly history plus optional liquidity detail | Near-term receivable, payable, reserve and available-credit context |
| Weekly forecast inputs | Forward-looking 13-week liquidity questions and reserve-risk analysis |
| Provider-normalized item data | More current item-level timing, monitoring and reconciliation |
| Published forecast cases | Case comparison, assumption sensitivity and actual-versus-plan guidance |

For mixed sources, Elidan records field-level or record-level provenance and applies an approved source-precedence policy. It does not silently add overlapping bank and accounting transactions, replace user-confirmed expected dates, or combine currencies. Conflicts enter a review queue before they influence a material calculation.

Every Ask CFO answer and AI Insight records the context level, source periods, data version, freshness and material missing inputs used. An unsupported question produces an explanation and focused enrichment step instead of a guessed answer.

### Manual and spreadsheet-first onboarding

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

Banking connections can confirm balances and cash movements but do not by themselves identify every invoice, bill, payroll obligation, tax payment or future commitment. Their onboarding result therefore enables supported cash-position and transaction-derived analysis while requesting targeted operating context for forecasting.

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

Define the read-only readiness/context result consumed by future Ask CFO and AI Insights. Its initial implementation may derive monthly-history capability without forecast tables so upgraded customers receive immediate value while later forecast increments add weekly capability.

Implementation uses two framework-independent modules:

- `cashForecast.ts` validates a single-currency forecast, applies explicit non-mutating assumptions and rolls actual available cash through exactly thirteen seven-day periods. It reports weekly inflows, outflows, operating cash flow, ending cash, reserve breaches, category totals, coverage and unresolved items. Overdue items remain unresolved and are never silently moved into the current week. Missing amounts/dates, confirmed zeroes, inactive items, outside-horizon items, low confidence and stale source evidence remain distinct.
- `financialContextReadiness.ts` evaluates historical, current, insight, forecast and case-comparison readiness separately. Valid monthly history can support Ask CFO and AI Insights while forecast capability requests targeted weekly inputs. Provider presence is not a readiness requirement.

The engine accepts freshness thresholds as policy inputs rather than embedding still-unapproved product durations. It accepts configurable currency precision, validates category direction to prevent sign errors and excludes funding from operating cash flow. Variance classification requires an explicit mapping or resolution and distinguishes on-plan, amount, timing, combined, unplanned, cancelled/missed and unresolved outcomes.

### FORECAST-01C — account-scoped storage

Add forecasts, immutable versions, cash items, schedules, assumptions and source lineage with least-privilege policies and atomic publish/version operations. Include rollback and two-session concurrency verification.

Implementation adds account-owned forecast aggregates plus version, schedule, item, assumption and assumption-to-item records. Composite foreign keys prevent children or evidence from crossing account/version boundaries. Authenticated clients can read only their own rows; all writes and both lifecycle operations are service-only.

`begin_cash_forecast_draft` locks the account's business profile before finding or creating its one active forecast and assigning the next version number. `publish_cash_forecast_version` locks the forecast and draft, rejects an outdated draft token or unresolved active item, supersedes the prior published version for the same case and publishes the deterministic result in one transaction. Published and superseded versions and children cannot be edited or directly deleted.

Lifecycle decisions for this increment:

- minimum reserve is stored on every version; Settings supplies a suggested starting value that the user can review;
- plan downgrade does not delete forecasts or version history; entitlement controls whether the workflow is editable;
- **Clear Financial Data** continues to clear imported historical actuals only. It does not silently delete forecasts; a source-version mismatch makes affected forecast context stale until reviewed;
- forecast records can be archived during the account's lifetime and are hard-deleted only through account deletion, which cascades through the complete forecast record graph;
- exact freshness durations remain configurable policy inputs and do not live in storage constraints;
- advisor edit/comment permissions remain blocked on ORG-01/ADV-01 rather than being inferred from account ownership.

### FORECAST-01D — Core manual workflow

Build the accessible 13-week page, manual item workflow, base forecast, exact-value table, review queue and forecast-to-action handoff. Add a dedicated forecast spreadsheet only if manual testing proves it reduces owner effort.

Implementation adds `/dashboard/forecast` and corrects the existing entitlement from the obsolete Growth-only 12-month placeholder to the approved Core 13-week base forecast. Starter sees an explanatory upgrade view. Core and higher tiers can establish actual available cash and reserve, enter dated cash items using owner-friendly categories and confidence, inspect a weekly cash curve and exact-value table, review unresolved/stale items, publish an immutable version and begin a rolling update from that version.

The browser may calculate a live preview, but publication always reloads account-owned records and recalculates with the deterministic engine on the server. Published totals are never accepted from the browser. Core permits one draft and one published base version at a time. Rolling an update copies the prior Core items atomically and changes completed or cancelled items to excluded so they cannot silently affect the next horizon.

Forecast-created actions retain the immutable forecast version and optional item through account-matching composite foreign keys. The initial reserve-risk handoff creates an editable Action Tracker draft tied to the version that produced the finding.

Initial freshness policy is three days for starting cash and seven days for manual item evidence. These durations are application policy constants rather than database constraints and can be revised without rewriting historical versions. A dedicated forecast workbook remains deferred until observation of the manual workflow shows that it would materially reduce owner effort.

### FORECAST-01E — Growth cases and variance

Add retained downside/upside cases, version comparison, weekly actual matching and variance explanations. QuickBooks ingestion remains INT-01 and publishes through the same normalized records.

## Open release decisions

Remaining release decisions before the affected UI or professional workflows:

- provider-specific freshness thresholds for invoices and bills beyond the initial manual policy;
- which forecast records an advisor may edit versus comment on after ORG-01/ADV-01;
- launch wording and disclosures through LEGAL-01;
- replacement of current “12-month cash flow forecast” marketing copy with the approved 13-week capability and any later long-range planning label.

Approved direction: Core has one active base forecast with immutable published version history. Growth adds retained alternative cases and comparison. Actual bank evidence controls cash balances, accounting providers control invoice/bill records, and user corrections are explicit audited overrides; detailed mixed-source precedence and conflict resolution remain part of INT-01/storage design.

## Upgrade acceptance requirement

A Starter customer with valid version-2 financial history who upgrades to Core or higher can use Ask CFO and receive supported AI Insights as soon as the subscription update is effective. Existing monthly records, settings, alerts and actions are reused. The absence of QuickBooks or weekly forecast inputs limits only the affected questions. The product asks for specific missing data when the customer requests unsupported forward-looking analysis and never requires a duplicate historical upload.

## New-customer onboarding acceptance requirement

A customer who initially purchases Core, Growth or Advisory is evaluated by the same capability-readiness rules before Ask CFO, AI Insights or forecasting claims are presented. Spreadsheet, accounting-platform and banking paths converge on shared normalized records, reconciliation, freshness and completeness checks. The onboarding flow clearly shows what is ready, what evidence supports it and what targeted information would unlock the next capability. A provider connection alone never implies that every feature has sufficient data, and the absence of a provider never prevents spreadsheet or manual customers from reaching the same supported capability state.

