# Elidan financial metric contract

**Status:** Approved product direction  
**Version:** 0.2  
**Approved:** 24 October 2026 by the product owner  
**Backlog item:** FIN-01

## Purpose

Elidan provides CFO guidance to small and medium business owners who may not have accounting training. Its financial model starts with the decisions those owners need to make:

1. Can the business cover payroll, bills and other obligations over the next few weeks?
2. How much protection does it have if collections slow or stop?
3. Is cash improving or declining, and why?
4. Is the business profitable, independently of its cash timing?
5. What action should the owner take?

Runway is one conditional liquidity measure. It is not the organizing concept for every business and is not displayed as a depletion concern when normalized cash activity is break-even or cash-generating.

This contract defines metric meaning and implementation direction. FIN-02 implements the legacy-data compatibility model in the dashboard, alerts and manual calculator without changing database rows or the distributed spreadsheet. DATA-01 will introduce the versioned financial input model and spreadsheet. FIN-03 will implement the expanded shared calculation engine.

**Implementation status (24 October 2026):** FIN-02 and DATA-01 are in production. Existing version-1 `total_revenue` and `total_expenses` values remain on the FIN-02 compatibility path. New version-2 records use the classified cash contract. [FIN-03A](fin-03-normalized-engine.md) implements the framework-independent version-2 engine locally; application cards, alerts and calculators remain unchanged until later FIN-03 integration increments are validated.

## Governing principles

1. Missing, confirmed zero, incomplete and not applicable are different states.
2. Cash activity, profit, revenue, expenses and balance-sheet amounts are different measures.
3. Financial-statement classifications and management-liquidity adjustments remain distinct and reconciled.
4. Funding and borrowing are not operating revenue. Equipment purchases and debt principal are not operating expenses.
5. Recurring owner compensation requirements affect liquidity even when an owner draw or distribution is classified outside operating activity for accounting purposes.
6. Operating, investing and financing cash flows follow the core classifications in [IAS 7](https://www.ifrs.org/issued-standards/list-of-standards/ias-7-statement-of-cash-flows/) and [FASB Statement 95](https://storage.fasb.org/aop_fas95.pdf). Elidan may add clearly labelled management views without rewriting those classifications.
7. Cash available for ordinary obligations excludes material restricted or reserved amounts. Unused borrowing capacity is shown separately from cash.
8. Every derived metric carries its as-of date, source, basis, measurement window and completeness state.
9. Estimates and sensitivities disclose their assumptions. Elidan does not imply precision the source data cannot support.
10. Spreadsheet and accounting integrations normalize into one versioned contract. A provider can improve input quality without silently redefining a metric.
11. Deterministic calculations produce numeric metrics and rule-based alerts. Generative AI may explain them but cannot invent or replace them.

## Product model: cash health

### Available cash

Cash and cash equivalents available to meet ordinary business obligations as of a stated date.

`available cash = included cash and cash equivalents − unavailable or reserved amounts`

Unavailable or reserved amounts include material cash that cannot prudently be used for ordinary operations, such as restricted accounts and identified sales-tax or payroll-withholding obligations. Show the total, exclusions and available amount. Transfers among included cash accounts do not change available cash. Unused credit is not cash and is displayed separately with borrowing and repayment context.

### Near-term obligations coverage

A forward-looking view of whether available cash and realistically expected receipts cover obligations over a defined short period:

`coverage surplus or gap = available cash + expected receipts − scheduled payments`

Expected receipts require due dates, aging and a collection assumption. Scheduled payments require due dates. Aggregate AR and AP alone do not establish timing and are never fully added to or subtracted from cash without those details.

The target planning view is a rolling 13-week cash forecast. Until it exists, trailing measures disclose that they do not include all future payments.

### Cash cushion

A stress measure answering: if collections stopped, approximately how long could available cash support normalized recurring cash payments?

`cash cushion = available cash ÷ average normalized recurring monthly cash payments`

Cash cushion is different from runway and remains useful for cash-generating businesses. It requires known cash and a positive payment denominator. Elidan does not present three to six months as a universal healthy range; the appropriate target depends on the business and its obligations.

With legacy data, use `reported spending coverage = reported closing cash ÷ average reported cash paid`. Label it as reported spending coverage because the payment total may include one-time or non-operating uses.

### Cash direction and conditional liquidity runway

`normalized recurring net cash flow = recurring cash inflows − recurring cash outflows`

`normalized recurring cash burn = max(−normalized recurring net cash flow, 0)`

When normalized recurring cash flow is negative:

`liquidity runway = available cash ÷ average normalized recurring cash burn`

When it is zero or positive, runway is not applicable. Describe the measured period as break-even or cash-generating and continue to show cushion, obligations and risks. Never display “Stable” or infinite runway.

Liquidity runway includes recurring obligations that consume cash, including scheduled debt principal, recurring owner draws and other commitments. Operating cash flow remains a separate performance view.

For legacy compatibility:

`estimated net cash from reported activity = average cash collected − average cash paid`

`estimated net cash burn = max(average cash paid − average cash collected, 0)`

`estimated cash runway = reported closing cash ÷ estimated net cash burn`

The dashboard and manual calculator use this same compatibility definition during FIN-02. The existing expense-only result becomes Reported spending coverage; average cash paid remains visible as Average monthly cash spending.

## Supporting financial views

### Operating cash flow

`net operating cash flow = operating cash receipts − operating cash payments`

Funding, borrowing, asset sales, capital purchases, debt principal and owner distributions remain outside accounting operating cash flow.

### Management liquidity adjustments

Recurring owner compensation, debt principal, leases, committed recurring capital payments and other required recurring uses affect liquidity even when classified as financing, investing or equity. Owner payroll already in operating payroll is not added again. Owner draws remain separately visible. One-time activity remains in the cash bridge without silently becoming a recurring assumption.

### Net change in cash and reconciliation

`net change in cash = closing cash − opening cash`

`opening cash + operating cash flow + investing cash flow + financing cash flow + other or FX adjustments = closing cash`

Net change is not operating performance. A material reconciliation difference is shown for correction or confirmation; Elidan does not create an unexplained balancing entry.

### Profitability

Profit and cash remain separate. A profit-and-loss view uses an identified accounting basis and does not infer profit from cash collected minus cash paid. The current spreadsheet cannot produce a complete accrual profit measure.

### Receivables and payables

AR is not cash until collected; AP is not necessarily due immediately. Aggregate balances support context such as `reported unpaid bills exceed available cash`, but accurate collection, overdue and near-term coverage guidance requires aging, due dates and collection assumptions. `AR > cash` is not inherently unhealthy.

### Month-end and intra-month liquidity

Month-end cash can hide lower balances around payroll or payment dates. Monthly data cannot establish the lowest intra-month balance. Disclose this until transaction timing, a lowest observed balance or a 13-week forecast is available.

## Measurement windows and completeness

Use the latest three consecutive completed calendar months with comparable currency, basis, source classification and reconciliation quality.

- One completed month may produce a limited-history display estimate.
- Two consecutive completed months may produce a limited-history display estimate.
- Three consecutive completed months produce the standard estimate.
- One- and two-month estimates do not trigger non-dismissible runway alerts.
- Never cross a missing or incompatible month to assemble three observations.

A missing required cash, receipt or payment value breaks the window. If the newest completed month is incomplete, the current result is unavailable. If an older month is incomplete, stop there and use the shorter disclosed sample. Confirmed zero remains valid.

Partial months do not enter completed-period averages. They may provide newer cash only with an explicit cutoff date. Cash shows its own as-of date; the run rate shows its completed-month window; projections begin at the cash cutoff. The organization reporting timezone determines completion. A legacy current-month row without a cutoff is not silently treated as completed month-end data.

### Staleness

Age is measured from the latest completed period end in the reporting timezone.

- 0–45 days: current monthly data.
- 46–90 days: stale; show the last-known metric, as-of date and update warning. Risk messages state the historical period.
- More than 90 days: historical; do not present it as current runway or emit current-state runway alerts.

Do not subtract elapsed time from historical runway without observing intervening cash activity.

### Seasonality

With twelve consecutive comparable months, compare the latest three-month result with the trailing-twelve-month result. Describe a material difference as divergence that may reflect seasonality, not proof. With twenty-four months, same-period prior-year comparisons can support stronger analysis. The materiality threshold is deferred to FIN-03.

## Depletion projection and sensitivities

`estimated depletion date = as-of date + runway × 30.436875 days`

Display month and year, not an exact day. For example, 6.5 months from 31 March produces October. The current floored, first-of-month method is superseded.

A raw minimum/maximum range from three months is not a confidence interval. When representative normalized data exists, Elidan may show a rounded base estimate and a downside sensitivity using the highest representative recurring burn. An upside bound appears only when supported. One-time activity, mixed signs, missing data or short history can make a range unavailable.

## Alert contract

Alerts use the definitions displayed on the dashboard.

- Runway alerts use legacy estimated liquidity runway during FIN-02 and normalized recurring liquidity runway after DATA-01/FIN-03.
- Runway warning/danger requires three consecutive completed comparable months.
- No runway alert fires when runway is unavailable or not applicable.
- Data older than 90 days does not create current-state runway alerts.
- Preserve saved numeric thresholds during transition and explain once that the calculation changed. Re-evaluate the default six- and three-month thresholds before release.
- Rename customer-facing `BURN_RATE_SPIKE` to Cash spending increase while it compares cash paid.
- Rename legacy `REVENUE_GROWTH` language to Cash collections increased.
- Replace the implication that AR exceeding cash is inherently unhealthy. Add AP-versus-cash context with a warning that aggregate AP may not all be due immediately.
- Continue comparing available cash with the customer's reserve. Keep runway to reserve separate from runway to zero.

## Manual calculator and chart

The calculator uses the same engine and labels as the dashboard. Authenticated users use saved thresholds; standalone use discloses defaults. It distinguishes cushion from conditional runway and shows 0.0 months with cash-deficit context for nonpositive cash and positive burn.

Legacy spreadsheet chart data is labelled Cash collected vs cash paid. Revenue vs Expenses is reserved for an identified profit-and-loss basis. The `13f7620` chart copy is scheduled for FIN-02 reconciliation; its current label does not redefine source fields.

## Spreadsheet and source contract

The early template is historical input, not the authority. The next version is redesigned before launch.

### Required monthly core

- Reporting month
- Complete or partial status and partial cutoff date
- Opening and closing included cash
- Cash collected from customers
- Operating cash paid
- Closing unavailable or reserved cash
- Reporting currency

### Required cash bridge classification

Users enter zero when an activity is confirmed absent and leave blank when unknown:

- Owner draws or distributions paid
- Debt principal and interest paid
- Investing cash paid and received
- New loans or credit drawn
- Owner contributions or equity funding received
- Taxes collected or withheld and reserved
- Other cash inflows and outflows

Guidance prevents double counting, including owner salary already in payroll, interest already in another total, and transfers among included accounts.

### Optional liquidity detail

- AR outstanding and receivables expected within 30 days
- AP outstanding and bills due within 30 days
- Available credit and credit currently drawn
- Lowest observed cash balance
- Known large upcoming receipts and payments with dates

### Workbook behavior

- Remove Burn Rate as an input or authoritative workbook result.
- Rename Total Revenue to Cash collected from customers and Total Expenses to Operating cash paid.
- Calculate Net change in cash and the classified cash bridge.
- Show reconciliation differences without forcing a balance.
- Explain fields in plain language and preserve blank versus zero.
- Never rely on cached formula results during import.
- Block invalid data and disclose unknown classifications during review.

Provider adapters populate the same contract with explicit company, source, basis, currency, period, completeness, account inclusion and reconciliation metadata.

## Current-state retrospective

| Area | Current behavior | Approved correction |
| --- | --- | --- |
| Spreadsheet | Cash collected, all money paid and total bank balance; Burn Rate equals expenses. | Replace with the versioned cash-health contract and remove burn as an input. |
| Dashboard Monthly Burn | Up to three newest non-null expense records, including across gaps. | Present spending separately; never skip gaps or missing required inputs. |
| Dashboard Runway | Closing cash divided by average expenses. | Reframe as spending coverage; compatibility runway uses collected minus paid. |
| Manual calculator | Expenses minus revenue with fixed thresholds. | Share the approved engine and account thresholds. |
| Cash-out month | Floors runway from the first day of the latest month. | Anchor on the cash as-of date, retain fractions and display an estimated month. |
| Nonpositive burn | Displays Stable or Not burning cash. | Describe observed break-even/cash generation; runway is not applicable. |
| Negative cash | Can produce negative runway. | Show 0.0 months with cash-deficit context when burn is positive. |
| Alerts | Use expense coverage and misleading burn/revenue/AR terminology. | Apply the alert contract and communicate the transition. |
| Chart | Labels cash-basis fields Revenue vs Expenses. | Use Cash collected vs cash paid for legacy data. |
| Source metadata | Currency, basis, completeness and source are not stored per month. | Add them in DATA-01. |

## Worked examples

### Template Scenario A

January–March 2026 end with $190,200 cash. Average cash paid is $50,600 and average cash collected is $54,000.

- Reported spending coverage: about 3.8 months
- Estimated net cash from reported activity: positive $3,400 per month
- Estimated cash runway: not applicable

The old “14+ months runway” description is unsupported and must be replaced.

### Template Scenario C

January–March 2026 end with $20,400 cash. Average cash paid is $46,700 and average cash collected is $29,500.

- Reported spending coverage: about 0.4 months
- Estimated net cash burn: $17,200 per month
- Estimated cash runway: about 1.2 months

The old 2.5-month description is unsupported and must be replaced.

### Owner funding

Opening cash $40,000 + operating receipts $30,000 − operating payments $45,000 + owner funding $50,000 = closing cash $75,000. Operating cash flow is negative $15,000, financing is positive $50,000 and net cash change is positive $35,000. Funding does not make operations positive.

### Equipment purchase

Opening cash $100,000 + operating receipts $60,000 − operating payments $50,000 − equipment $30,000 = closing cash $80,000. Operations generated $10,000 while investing used $30,000. Show both; positive operations do not remove liquidity risk.

### Recurring owner draw and debt

Operating cash flow is positive $8,000, recurring owner draw is $6,000 and monthly debt principal is $5,000. Accounting operating cash flow remains positive; management recurring cash flow is negative $3,000 and can support a liquidity runway when cash is known.

### Missing and partial months

January, February and April with March missing produces at most an April one-month estimate and no non-dismissible runway alert. April data through 10 April stays month-to-date; the completed run rate uses January–March only when all three exist, while newer cash requires an explicit 10 April cutoff.

### Zero, reserved cash and reserve runway

A confirmed $0 collection with $12,000 paid produces $12,000 estimated burn; a blank collection makes the result unknown. Total cash $100,000 less $25,000 unavailable gives $75,000 available and 5.0 months at $15,000 burn, not 6.7. With $120,000 available and a $30,000 reserve, runway to zero is 8.0 months and runway to reserve is 6.0 months.

### Fractional projection

6.5 months from cash as of 31 March produces an estimated depletion month of October, without implying an exact day.

## Delivery allocation

### FIN-02

Split spending coverage/cushion from estimated net-burn runway; align dashboard and calculator; update card/chart/alert language; apply supported completeness and staleness rules; correct Scenario A/C expectations; communicate the changed runway meaning without rewriting stored data.

### DATA-01

Add versioned period, cutoff, timezone, currency, basis, source, availability, classification, recurrence and reconciliation fields. Redesign the template and review flow. Preserve or explicitly retire legacy test data without silently reclassifying it.

### FIN-03

Implement cash health, normalized cash flow, cushion, conditional runway, projections, sensitivities and alerts once. Set and test seasonality materiality and default thresholds. Cover funding, draws, debt, taxes, investing, gaps, stale/partial data, negative cash and reconciliation failures.

### Later features

Rolling 13-week forecast; invoice/bill aging; intra-month liquidity; industry reserve benchmarks; stronger multi-year seasonality; and distinct profit-and-loss reporting and forecasting.

## Explicitly deferred decisions

- FIN-02 layout, help pattern and transition notice
- DATA-01 database names, constraints, migrations and final template layout/copy
- Reconciliation tolerance by currency and source
- Interest and income-tax policy options by reporting basis
- One-time versus recurring normalization rules
- Seasonality materiality threshold
- Sensitivity eligibility and calculation details
- Default cushion/runway alert thresholds
- 13-week forecast workflow
- QuickBooks report/account mappings and accounting-method selection
- Customer-facing disclosures under LEGAL-01, subject to counsel approval

