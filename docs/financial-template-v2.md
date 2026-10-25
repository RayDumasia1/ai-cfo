# Financial template v2

**Status:** DATA-01B workbook staged; DATA-01C database verification passed in preview; end-to-end upload validation pending
**Date:** 24 October 2026
**Depends on:** [Financial data contract v2](financial-data-contract-v2.md)

## Launch decision

Elidan has no customer financial data to migrate before launch. The existing version-1 workbook and rows are development fixtures only. New customers will start on the version-2 workbook and classified cash model.

The version-2 workbook is staged at [the template candidate](templates/elidan-financial-template-v2.xlsx). It does not replace the public download until the DATA-01C parser and transaction pass preview validation. Existing version-1 test fixtures remain available during that transition and will not be reclassified automatically.

## Workbook structure

- **Start Here:** business context, reporting currency, accounting basis and short completion guidance. Workbook alert thresholds are intentionally absent because users manage them in Elidan Settings.
- **Monthly Cash:** 36 blank monthly rows for the required contract fields. Inputs distinguish operating activity, owner distributions, debt principal and interest, investing activity, debt and owner funding, other cash activity, closing cash and unavailable cash.
- **Optional Detail:** taxes reserved, receivables expected within 30 days, bills due within 30 days, available credit, credit drawn and lowest observed cash. Month cells link to the matching Monthly Cash row.
- **Worked Example:** one reconciled reference month outside the import sheet. It illustrates classification without becoming customer data.

The workbook deliberately omits the old sample-scenario sheet and expense-category import. Those structures encouraged users to treat revenue and expenses as a complete cash model. Expense detail can return later as a separately defined supporting view without changing the cash bridge.

## Input behavior

Yellow cells with blue text are editable. Gray cells contain calculations.

- A blank required amount means unknown.
- A numeric zero means the user confirmed that no activity occurred.
- Complete periods must not have a cutoff date.
- Partial periods require a cutoff date within the reported month.
- All non-balance cash components are nonnegative magnitudes.
- Unavailable cash cannot exceed nonnegative closing included cash.
- The workbook flags duplicate months and dates that do not begin on the first day of a month.

Each Monthly Cash row calculates:

`closing included cash − opening included cash − classified net cash activity`

A difference within one reporting-currency unit is shown as ready in the workbook. DATA-01C must independently validate every rule server-side and must never trust workbook formulas, cached results, colors or validation controls.

## DATA-01C parser map

Global Start Here values map to each version-2 month as follows:

| Workbook label | Stored field |
| --- | --- |
| Reporting currency | `reporting_currency` |
| Accounting basis | `accounting_basis` |
| Workbook source | `source_type = spreadsheet` |
| Workbook contract | `data_contract_version = 2` |

Monthly Cash labels map to the required cash-perimeter and bridge columns documented in the financial-data contract. `Asset purchases` maps to `investing_cash_paid`; `Asset sale proceeds` maps to `investing_cash_received`; `New debt received` maps to `debt_funding_received`; and `Owner or equity funding` maps to `owner_funding_received`.

The implemented parser ignores the workbook's `Reconciliation difference` and `Row check` values. It recalculates the bridge server-side and rejects an absolute difference above one reporting-currency unit. It merges Optional Detail by month, rejects duplicates and orphan detail, preserves blank optional values as null and sends only validated rows to the reviewed transaction.

The strict database function independently allowlists fields, requires homogeneous version-2 spreadsheet rows, checks reconciliation again, archives displaced data and writes the profile fill, affected months, data version and success audit atomically. The existing version-1 engine remains unchanged. The reviewed wrapper rejects mixed contracts and prevents an update-mode version-1 upload from overwriting an existing version-2 month.

For compatibility until FIN-03 is complete, version-2 imports derive the existing dashboard columns as follows:

- `opening_cash` and `closing_cash` mirror the included cash perimeter.
- `total_revenue` mirrors customer cash collected.
- `total_expenses` is operating cash paid plus owner draws, debt principal, debt interest, investing cash paid and other cash outflows.

These values are a temporary dashboard projection. The classified version-2 columns remain authoritative, and funding or asset-sale receipts are not reclassified as operating revenue.

Apply [the DATA-01C migration](migrations/2026-10-24-v2-financial-import.sql) in preview after DATA-01A, then run [the rollback verifier](migrations/verify-v2-financial-import.sql) with two dedicated preview accounts. Do not run the verifier in production.

The migration and complete rollback verifier passed in preview on 24 October 2026.

## Verification completed

- All four sheets were rendered and visually reviewed.
- The exported XLSX retains formulas, conditional formatting, native dropdown/numeric validations and freeze panes.
- A representative complete month recalculates to zero difference and `Ready to upload`.
- Excess unavailable cash and an unexplained closing balance produce specific correction messages.
- The template test checks sheet names, exact classified headers, blank customer rows, formulas and the reconciled example.
- Parser and route tests cover confirmed zero versus blank, cutoff dates, reconciliation failures, optional-detail ownership and the exact atomic payload.
