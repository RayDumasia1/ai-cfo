# FIN-03 normalized cash engine

**Status:** FIN-03A and FIN-03B in preview; FIN-03C1 implemented locally; FIN-03C2 approved
**Date:** 24 October 2026  
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

Saving and naming scenarios, multi-scenario comparison, event timelines, AI goal seeking, AI narrative guidance, sharing and CFO/advisor collaboration remain later Core/Growth/Advisory capabilities. The initial FIN-03C experience is local and unsaved, so it requires no database migration.

## FIN-03B customer-facing integration

For version-2 datasets, the four dashboard cards become Available Cash, Operating Cash Buffer, Operating Cash Trend and Operating Runway. Available Cash subtracts the reported unavailable amount and shows it separately. Operating cards use customer collections and operating payments; runway copy states that debt principal, owner draws, investing activity and future commitments are excluded. Partial-period cash uses its cutoff date while the trend window remains limited to completed months.

The metric row uses four equal minmax columns on wide screens, two columns on tablets and one column on narrow screens. Values may wrap instead of forcing one column wider than the others. Trend language leads with the owner decision signal—collections or spending outpaced the other—and a single note below the cards explains the operating scope and exclusions without repeating dense methodology in every card. The alert disclosure remains present where the limitation is material to an urgent runway conclusion. The alerts disclosure control exposes its expanded state to assistive technology.

Version-2 alerts use distinct identifiers so legacy dismissals cannot hide a newly defined operating alert:

- `OPERATING_RUNWAY_DANGER` and `OPERATING_RUNWAY_WARNING` require three eligible current months;
- `OPERATING_SPENDING_INCREASE` compares consecutive eligible operating cash payments;
- `AVAILABLE_CASH_BELOW_RESERVE` compares available cash with the saved reserve;
- `CUSTOMER_COLLECTIONS_INCREASE` compares consecutive eligible customer collections.

Operating runway danger and available-cash reserve alerts remain protected from dismissal. The legacy accounts-receivable comparison is not emitted for v2 because the approved contract does not treat receivables exceeding cash as inherently unhealthy. Historical v2 data emits no current-state alerts. No database migration accompanies FIN-03B; alert-code columns are text and existing action links accept bounded text values.
