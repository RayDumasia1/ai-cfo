# Financial template v2

**Status:** DATA-01B launch workbook staged; parser support pending
**Date:** 24 October 2026
**Depends on:** [Financial data contract v2](financial-data-contract-v2.md)

## Launch decision

Elidan has no customer financial data to migrate before launch. The existing version-1 workbook and rows are development fixtures only. New customers will start on the version-2 workbook and classified cash model.

The version-2 workbook is staged at [the template candidate](templates/elidan-financial-template-v2.xlsx). It does not replace the public download until DATA-01C can parse, review and publish the full contract atomically. Existing version-1 test fixtures remain available during that implementation and will not be reclassified automatically.

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

The parser must ignore the workbook's `Reconciliation difference` and `Row check` values, calculate reconciliation itself and reject or explicitly review material differences. The parser must merge Optional Detail by month, reject duplicates, preserve blank optional values as null and enforce the same account-isolated atomic publication used by the current reviewed import.

## Verification completed

- All four sheets were rendered and visually reviewed.
- The exported XLSX retains formulas, conditional formatting, native dropdown/numeric validations and freeze panes.
- A representative complete month recalculates to zero difference and `Ready to upload`.
- Excess unavailable cash and an unexplained closing balance produce specific correction messages.
- The template test checks sheet names, exact classified headers, blank customer rows, formulas and the reconciled example.
