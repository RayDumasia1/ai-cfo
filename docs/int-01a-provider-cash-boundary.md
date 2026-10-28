# INT-01A — provider cash normalization and publication boundary

**Date:** 28 October 2026

**Status:** Implemented foundation; live QuickBooks authorization, retrieval and publication remain unavailable.

**Depends on:** [cash metric contract](financial-metric-contract.md), [monthly contract v2](financial-data-contract-v2.md), [forecast/source lineage](forecast-01e-actual-versus-plan.md)

## Bounded outcome

`lib/providerCashNormalization.ts` validates a canonical cash-ledger snapshot and projects one reconciled, complete calendar month into the existing v2 fields. `lib/providerPublicationPlan.ts` classifies overlap with a stored month. Neither function authenticates users, retrieves provider data, writes financial rows, starts jobs, stores tokens or consumes AI usage. There is no public normalization/publish endpoint. The existing Core-gated QuickBooks endpoint continues to return an explicit non-cacheable `501 FEATURE_NOT_IMPLEMENTED`.

This is the first implementation increment for INT-01, not a launched accounting integration. No schema or production-data migration is required. The initial defaults deliberately require source review instead of silently replacing spreadsheet history or accepting incomplete retrieval as zero.

## Evidence, scope and account perimeter

A future trusted server adapter must provide a stored workspace/company binding, the independently resolved expected job scope, and a batch scope. Business ID, connection ID, provider company/realm ID, generation and reporting currency must agree. A connection must be active, and its selected included-cash account set must be explicitly confirmed. Actor authorization belongs before this boundary; client-supplied company IDs are never sufficient. Workspace ownership remains independent of any permanent one-user/one-business assumption.

The source basis is explicitly `direct_cash_ledger`. Each selected account supplies known opening/closing decimal balances for the same requested dates. Missing accounts, extra/duplicate account snapshots, missing balances or unknown unavailable cash block the candidate. Opening/closing included cash can be negative for overdrafts. Unavailable cash needs an explicit confirmed nonnegative amount and cannot exceed nonnegative total included closing cash. Optional credit, AR/AP, tax-reserve detail, payroll detail and lowest observed cash remain null when not supplied; they are not manufactured as zero.

The adapter must prove complete retrieval, exhausted pagination and complete period coverage. The first boundary supports full calendar months that ended before the company's evaluation date. Posting dates are company-calendar dates, separate from UTC retrieval timestamps. Balance dates must match the full period; a current account balance cannot stand in for a historical closing balance. Retrieval must be within one hour of the trusted evaluation time and cannot be future-dated. This retrieval check does not relabel an old financial period as current cash.

Scope generations are opaque, nonempty server-owned values. The pure validator rejects stale/disconnected work, but INT-01A does **not** add a persisted generation or modify Clear Data. The future storage increment must rotate the persisted generation on Clear Data, disconnect, relink and perimeter changes, invalidate queued work and recheck it in the publication transaction. A preflight result is never a write authorization.

## Canonical movements and cash meaning

This boundary accepts canonical posted cash facts, not raw reports, invoices, bills or webhook bodies. Every fact needs a stable qualified source identity and revision. The adapter must qualify identities by provider entity and any stable cash-leg identity, because different API entity types can reuse numeric IDs. Duplicate source identities within a complete batch are rejected; page overlap must not double-count activity.

Cash movement direction is derived from the selected perimeter's account legs. An approved classification must agree with that direction. The classifications are the existing monthly bridge fields, so the adapter must distinguish customer collections, operating payments, owner distributions, debt principal/interest, investing cash, financing receipts and other cash. This module guesses no category from a name, counterparty or amount. Detailed raw QBO-to-canonical mapping, refunds and allocation policy remain a later reviewed adapter increment.

An explicitly identified transfer between two included accounts changes their individual balances but contributes nothing to gross collections/spending or the consolidated bridge. A transfer crossing the included perimeter is other cash in/out; it is not operating performance. A non-cash document with no cash legs/classification is ignored. A supposed non-cash document carrying cash legs, an ambiguous internal transfer, wrong-direction classification or selected mixed-currency movement blocks normalization. No FX conversion is performed.

Pending, voided/deleted or otherwise unresolved cash records cannot be presented as effective posted facts. The future adapter must refetch the affected complete period and resolve corrected/deleted evidence before submitting a new authoritative snapshot. A notification or deletion tombstone is not a balancing cash event.

Intuit documents its Statement of Cash Flows as an accrual-basis report. Its report totals are therefore not assumed to be Elidan's direct customer collections or classified cash movements. [Intuit: Statement of Cash Flows](https://quickbooks.intuit.com/learn-support/en-us/help-article/financial-reports/run-statement-cash-flows/L7f72hT6Q_US_en_US)

Current Intuit webhook documentation requires authorized OAuth companies, signature verification and company-specific routing, including multiple companies in a notification. Future webhook work must validate and route notifications before fetching source facts; INT-01A accepts no raw webhook payload as financial evidence. [Intuit: configure webhooks](https://static.developer.intuit.com/output_html/qbo/docs/develop/webhooks/configure-webhooks.html)

## Exact arithmetic and output

Amounts are canonical decimal strings at a trusted reporting precision of 0–4 decimal places. They are parsed into integer minor units using `BigInt`; aggregation and reconciliation do not use floating-point addition. Excess precision, exponents/locale formats, unsafe ranges and values that cannot survive JSON numeric serialization into the existing monthly contract are rejected. Negative movements are not used to smuggle direction changes; movement amounts are nonnegative and direction comes from account legs.

Every included account must satisfy opening balance plus incoming ledger legs minus outgoing legs equals closing balance **exactly** at the configured precision. Offset errors across accounts do not cancel out. This is stricter than the workbook's existing $1 bridge tolerance, which remains unchanged. Internal reconciliation establishes ledger consistency, not independent verification against a real bank statement. Source labels continue to identify QuickBooks accounting evidence.

A valid output uses contract v2, `source_type='quickbooks'`, direct-cash `accounting_basis='cash'`, complete period status and a null partial-period cutoff. It preserves the workbook's compatibility mapping: legacy revenue is customer collections; legacy expenses are all classified cash outflows, including separately visible financing/investing/owner uses. Funding/asset proceeds do not inflate customer collections, and non-operating uses are not silently treated as ordinary operating payments. The existing normalized engine consumes the same v2 meaning.

The provenance records policy `provider-cash-1`, workspace/connection/company/generation, reporting precision, month, selected accounts, perimeter fingerprint, evidence fingerprint, retrieval time and batch identity. Fingerprints sort source records/accounts deterministically and include exact minor units, event revisions and scope. Retrieval timestamps, batch IDs and input page ordering do not create spurious financial changes. The fingerprint is an evidence identity, not a signature, credential or authorization token. Future storage must retain the actual canonical source snapshot/lineage as well; a hash alone is not an auditable source archive.

Resource bounds are 100 selected account snapshots and 10,000 canonical movements per month. Inputs above those supported bounds fail instead of being truncated. No raw provider credentials, secrets or unbounded provider error messages are returned by this module.

## Publication conflict plan

| Decision | Meaning for a future writer |
| --- | --- |
| `blocked` | Evidence failed validation, the comparison period is wrong, or a different workspace was supplied. No write. |
| `new_month` | No stored month overlaps the candidate. Recheck authorization, current scope and generations atomically before considering an insert. |
| `unchanged` | Normalized values and evidence fingerprint match the same trusted source/perimeter/policy. Preserve financial data, owner notes and data version; track successful sync receipt separately. |
| `review_source_change` | Spreadsheet/manual/legacy history, missing source registry/workspace assignment, or changed company/connection/generation/perimeter/policy. Require explicit source review; never blend providers within a stored month. |
| `review_correction` | Same authoritative source but changed financial values or source evidence. Retain the prior revision and review the correction, including source changes that leave aggregate totals unchanged. |

All decisions carry `requiresAtomicRecheck=true`. The next writer must hold the financial workspace/profile lock, derive actor permissions, compare current data/source state and the expected data version, verify job generation/connection state, and atomically retain corrections before publication. A file upload or Clear Data occurring after this computation must invalidate the prepared operation. Monthly projections cannot be used to fabricate transaction-level actuals in the forecast review ledger.

## Validation and next increments

Tests use independently prepared cash bridges, multiple included accounts, internal/cross-perimeter transfers, all bridge categories, unpaid documents, explicit zero, overdrafts, exact-cent partitions, source retries, changed revisions, partial/failed retrieval, missing balances, stale jobs, currency mismatches, wrong classifications and offsetting account errors. The output is also consumed by the existing normalized cash-health engine to verify shared metric meaning. Conflict tests cover every decision without mutating source/stored objects. The unavailable HTTP boundary remains authenticated/feature-gated and refuses submitted publish payloads.

Validation on 28 October: all 40 focused boundary/HTTP tests passed; the full regression run passed 1,300 tests across 78 files, with four remote-only probes skipped by default. TypeScript, targeted lint and the production build passed. An existing case-screen test reached its five-second timeout during the first concurrent build/test run; the complete suite passed when rerun without a concurrent build. No existing UI behavior or timeout budget was changed. This increment needs no SQL migration and made no database writes.

Subsequent bounded increments:

1. **INT-01B — connection lifecycle:** OAuth state/company binding, server-only credential encryption/rotation, Core entitlement and workspace authorization, safe callback/disconnect and sandbox verification. Connected is distinct from data-ready.
2. **INT-01C — canonical retrieval:** approved cash perimeter/date range, explicit category mapping, complete paginated source retrieval, deterministic source identity, and reconciliation review. No publication from partial pages or report totals.
3. **INT-01D — atomic publication:** persisted source registry, generation checks integrated with Clear Data/disconnect, reviewed source takeover/corrections, idempotent receipts and retained revisions.
4. **INT-01E — recovery and owner acceptance:** bounded retries, authenticated webhook scheduling, full affected-period refetch, owner connection/status/review UI and hosted sandbox end-to-end acceptance.

This increment does not enable live sync, banking, Xero, AI answers or subscriptions/charges. Production promotion is a separate release step.
