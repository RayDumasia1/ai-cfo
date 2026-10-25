# FIN-03 normalized cash engine

**Status:** FIN-03A through FIN-03C in preview; FIN-03D and FIN-03E implemented locally
**Date:** 25 October 2026  
**Depends on:** [Financial metric contract](financial-metric-contract.md) and [financial data contract v2](financial-data-contract-v2.md)

## Scope

`lib/normalizedCashHealth.ts` is the deterministic, framework-independent FIN-03A engine. It accepts account-scoped monthly rows supplied by the server layer and performs no database or UI work.

The first engine calculates only conclusions supported by contract-v2 data:

- available cash equals closing included cash less closing unavailable cash;
- net operating cash flow equals customer cash collected less operating cash paid;
- operating cash burn is the positive cash shortfall when net operating cash flow is negative;
- operating cash coverage compares nonnegative available cash with average operating cash paid;
- estimated operating runway compares nonnegative available cash with average operating cash burn and is absent for break-even or cash-generating operations.

Funding, borrowing and investing proceeds never count as operating collections. Owner draws, debt principal, debt interest, investing payments and other classified movements never silently become operating payments.

Contract v2 identifies those movements but does not say whether each is recurring. FIN-03A therefore does not claim to calculate normalized recurring management cash flow or a complete liquidity forecast. Adding non-operating movements to a recurring-liquidity measure requires an explicit recurrence policy or new recurrence metadata in a later bounded increment.

## Eligible measurement window

The standard result uses the latest three consecutive complete months. One or two eligible months produce a limited-history result. The engine never skips an intervening month to assemble a window.

Every included month must:

- use data contract version 2 and a nonlegacy source;
- be complete and have no partial-period cutoff;
- have known, nonnegative customer collections and operating cash paid;
- have a known cash reconciliation difference within one reporting-currency unit;
- match the newest eligible month's currency, accounting basis and source type.

The one-unit reconciliation tolerance matches the reviewed v2 import boundary. A later currency-specific materiality policy may replace it; changing that policy requires parser, database and calculation alignment.

A newest partial v2 month may supply current cash using its cutoff date. Its activity never enters completed-month averages. The immediately preceding calendar month must be a usable complete month; the engine does not join newer cash to a run rate that skips the latest completed month.

## Explicit states

The result distinguishes unavailable, limited and standard history. It also records why the window stopped, including a gap, partial or invalid period, legacy data, missing or invalid values, reconciliation failure, or a change in currency, basis or source.

Confirmed zero is a valid value. Missing is unavailable. Negative available cash remains visible as a cash deficit, while coverage and runway use a zero numerator so they cannot become negative. Break-even and cash-generating operations have no estimated runway rather than an infinite or “stable” result.

## Release boundary

FIN-03A does not change stored data or SQL. FIN-03B dispatches dashboard cards and alerts by the latest row's contract version: version 1 remains on FIN-02, while version 2 uses this engine. The manual calculator and scenarios remain deferred to FIN-03C. Legacy rows are never reclassified as v2.

## FIN-03C calculator and scenario allocation

FIN-03C is split into two bounded increments. FIN-03C1 removes the calculator's separate formula path and makes dashboard, alert, calculator and scenario results use the same version-aware definitions and edge-case rules. Version-1 data remains on the FIN-02 compatibility model; version-2 data uses the normalized engine.

FIN-03C1 uses the exported `operatingCashMetrics()` primitive for both classified monthly data and manually entered What-If values. The manual inputs are explicitly Available cash, Monthly customer collections and Monthly operating spending; results use Available Cash, Operating Cash Buffer, Operating Cash Trend and Operating Runway. This increment aligns deterministic formulas and language. Loading the customer's saved baseline and baseline-versus-scenario controls remain FIN-03C2.

FIN-03C2 replaces the dashboard's placeholder three-field calculator with a useful Starter scenario experience. It starts from the customer's current saved baseline and shows baseline and proposed results for available cash, monthly operating surplus or shortfall, operating cash buffer and conditional operating runway. Starter users can adjust customer collections, operating spending and available cash, and can model a clearly separated one-time cash receipt or payment. The experience must distinguish recurring changes from one-time events, explain results in owner-friendly language, restore the saved baseline, and handle missing, limited, partial and stale data explicitly.

The FIN-03C2 implementation derives the baseline on the server and passes only the calculation inputs and provenance needed by the client. Version-2 baselines use available cash plus normalized complete-month operating averages; a valid partial latest period may provide the cash cutoff while completed months provide averages. Version-1 records retain the FIN-02 compatibility averages. The client performs no database calls and scenario changes are never persisted. Missing or incomplete baselines fall back to an explicitly labelled manual starting point. Stale and historical baselines remain usable with an update warning.

The dashboard gives the scenario planner the full content width and leaves import status on the dedicated Financial Data page, removing the dashboard's duplicate status card and query. Owners enter expected monthly cash from customers and operating-spending amounts directly; blank fields retain the saved baseline, avoiding signed adjustment arithmetic. Input placeholders show rounded, currency-formatted current values rather than raw calculated precision. Results describe surplus, shortfall, improvement and deterioration instead of relying on negative-number interpretation. One-time event choices use Cash coming in and Cash going out and remain visibly separate from recurring monthly assumptions.

Saving and naming scenarios, multi-scenario comparison, event timelines, AI goal seeking, AI narrative guidance, sharing and CFO/advisor collaboration remain later Core/Growth/Advisory capabilities. The initial FIN-03C experience is local and unsaved, so it requires no database migration.

## FIN-03D scenario-to-action handoff

After calculating a scenario, Starter users can turn each meaningful assumption into one editable action through the dashboard's existing shared Action modal. Collections increases map to revenue-growth actions, spending reductions map to expense-reduction actions, and adverse changes or one-time receipts/payments map to risk-preparation actions. Prefills retain the baseline, target and estimated runway context in bounded text. They pass through existing action validation, account scoping and tier capacity limits.

Unsaved Starter scenarios have no durable identifier, so FIN-03D does not write a scenario relationship and never stores scenario data in `linked_alert_code`. Non-USD scenarios preserve formatted context in the description but leave the current USD-only numeric goal fields empty. Saved-scenario linkage, versioned assumption snapshots, coordinated action sets and planned-versus-actual scenario reporting remain higher-tier work and will require an explicit action-origin model. FIN-03D requires no database migration.

## FIN-03E dedicated scenario workflow

Scenario planning lives at `/dashboard/scenarios`, with its own authenticated, verified-email and paid-subscription boundary. The dashboard shows a compact entry card with baseline date, completed-month coverage and stale-data guidance; it no longer renders the complete planning form. Scenarios also appear in primary navigation. The dedicated page retains the same unsaved Starter calculation and action handoff behavior, links created work to the Action Tracker, and makes clear that scenario inputs are not saved. Route-level loading and recoverable error states keep navigation responsive and state that failures do not change saved data. Removing the collapsible dashboard planner also removes its browser-storage preference. FIN-03E changes no formulas, tier allocation or stored data and requires no database migration.

## FIN-03B customer-facing integration

For version-2 datasets, the four dashboard cards become Available Cash, Operating Cash Buffer, Operating Cash Trend and Operating Runway. Available Cash subtracts the reported unavailable amount and shows it separately. Operating cards use customer collections and operating payments; runway copy states that debt principal, owner draws, investing activity and future commitments are excluded. Partial-period cash uses its cutoff date while the trend window remains limited to completed months.

The metric row uses four equal minmax columns on wide screens, two columns on tablets and one column on narrow screens. Values may wrap instead of forcing one column wider than the others. Trend language leads with the owner decision signal—collections or spending outpaced the other—and a single note below the cards explains the operating scope and exclusions without repeating dense methodology in every card. The alert disclosure remains present where the limitation is material to an urgent runway conclusion. The alerts disclosure control exposes its expanded state to assistive technology.

Version-2 alerts use distinct identifiers so legacy dismissals cannot hide a newly defined operating alert:

- `OPERATING_RUNWAY_DANGER` and `OPERATING_RUNWAY_WARNING` require three eligible current months;
- `OPERATING_SPENDING_INCREASE` compares consecutive eligible operating cash payments;
- `AVAILABLE_CASH_BELOW_RESERVE` compares available cash with the saved reserve;
- `CUSTOMER_COLLECTIONS_INCREASE` compares consecutive eligible customer collections.

Operating runway danger and available-cash reserve alerts remain protected from dismissal. The legacy accounts-receivable comparison is not emitted for v2 because the approved contract does not treat receivables exceeding cash as inherently unhealthy. Historical v2 data emits no current-state alerts. No database migration accompanies FIN-03B; alert-code columns are text and existing action links accept bounded text values.
