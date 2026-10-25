# FIN-03 normalized cash engine

**Status:** FIN-03A implemented; application consumers remain on FIN-02 until preview validation  
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

FIN-03A does not change dashboard cards, alerts, the manual calculator, stored data or SQL. FIN-03B will integrate the shared result into customer-facing behavior only after this engine and its language are validated. Legacy rows continue to use the FIN-02 compatibility path and are never reclassified as v2.
