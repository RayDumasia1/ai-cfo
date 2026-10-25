# Financial data contract v2 implementation

**Status:** DATA-01A schema verified in preview
**Date:** 24 October 2026  
**Depends on:** [Financial metric contract v0.2](financial-metric-contract.md)

## Purpose

Contract v2 adds the classified monthly inputs needed for more accurate cash-health guidance while preserving every legacy import. It is additive: existing columns, account ownership, unique month identity, atomic import functions, revision history and Clear Data behavior remain in place.

Existing records are version 1. Their `total_revenue` and `total_expenses` values retain legacy meanings and are never copied into classified v2 fields. New spreadsheet/provider publication will use version 2 only after the parser and reviewed-import transaction are updated in later DATA-01 increments.

## Storage decision

The v2 fields extend `public.financial_months` rather than creating a second one-to-one table.

- Existing `(user_id, month_date)` ownership and duplicate protection remain authoritative.
- Existing delete and account-isolation behavior automatically covers the new fields.
- Revision snapshots already use `to_jsonb(financial_months)`, so they include v2 values without a parallel snapshot table.
- Legacy import RPCs omit the new fields and receive version-1 defaults.
- A row cannot accidentally combine two separately managed records for the same account and month.

The wider monthly record is an intentional compatibility tradeoff. Future dated receipts/payments for a 13-week forecast need their own organization-owned commitments model after ORG-01; they do not belong as repeated columns on a monthly row.

## Version and source identity

Each month records:

- `data_contract_version`: `1` for legacy semantics or `2` for the classified contract.
- `source_type`: legacy spreadsheet, v2 spreadsheet, QuickBooks, manual or other.
- `accounting_basis`: cash, accrual, mixed or unknown.
- `reporting_currency`: three-letter uppercase ISO currency code.
- `period_status`: complete, partial or legacy/unknown.
- `period_cutoff_date`: required within the reporting month for a partial period and absent otherwise.

Version 2 requires a nonlegacy source, currency, basis, known period status, included opening/closing cash and every required cash-bridge component. Version 1 deliberately keeps nullable legacy behavior.

## Cash perimeter and bridge

The required v2 cash perimeter is:

- Opening included cash
- Closing included cash
- Closing unavailable cash
- Cash collected from customers
- Operating cash paid
- Owner draws paid
- Debt principal paid
- Debt interest paid
- Investing cash paid and received
- Debt funding received
- Owner/equity funding received
- Other cash inflows and outflows

Component values are nonnegative magnitudes. Opening, closing and lowest-observed cash may be negative to represent overdrafts or deficits. Closing unavailable cash cannot exceed nonnegative included closing cash.

Operating cash paid excludes debt principal, debt interest, owner draws, investing payments and other separately entered bridge uses. The workbook/parser guidance must prevent double counting across those fields.

`closing_taxes_reserved` is optional detail within closing unavailable cash. It is a closing balance and is not added to the cash bridge as another inflow.

The database generates `cash_reconciliation_difference` only when the entire required bridge is known:

`closing included cash − opening included cash − classified net cash movement`

The result remains null when any bridge component is unknown. The application will define the materiality tolerance and confirmation workflow in DATA-01C; the database does not create a balancing entry.

## Optional liquidity context

The monthly row can also store receivables expected within 30 days, bills due within 30 days, available credit, credit currently drawn and the lowest observed cash balance. Aggregate AR/AP legacy columns remain unchanged.

## Compatibility and deployment

The migration:

- Adds columns and validated checks only.
- Performs no financial-value backfill or reclassification.
- Gives old writers safe version-1/source/status defaults.
- Leaves all RPC signatures and grants unchanged.
- Causes prepared import-review fingerprints to change because the coherent review hash includes the full monthly JSON row. Users with an outstanding review must prepare it again after deployment.

[The migration](migrations/2026-10-24-financial-data-contract-v2.sql) and [the read-only verifier](migrations/verify-financial-data-contract-v2.sql) passed in preview on 24 October 2026. The verifier requires no test-account UUID and rolls back its catalog-check transaction. Production deployment remains deferred until the application can publish and consume version-2 rows.

## Deferred work

- DATA-01B: [v2 workbook layout, field guidance and formulas](financial-template-v2.md) staged; parser support pending.
- DATA-01C: dual-version parser, reviewed-import RPC publication, reconciliation review and tests.
- DATA-01D: transition UI, provenance display and end-to-end preview validation.
- FIN-03: normalized calculation engine and classified alerts.
- ORG-01/forecast work: organization-owned dated commitments and 13-week forecasting.
- QuickBooks: provider mapping, connection identity, synchronization and correction policy.
