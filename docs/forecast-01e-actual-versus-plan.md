# FORECAST-01E actual-versus-plan architecture

**Status:** FORECAST-01E1/E2 implemented; FORECAST-01E3 storage passed preview migration and contention verification; FORECAST-01E4 owner workflow implemented and automated validation passed 27 October 2026, owner preview acceptance pending

**Depends on:** [13-week cash forecast](forecast-01-13-week-cash-forecast.md), immutable published forecast versions, normalized cash categories and source lineage

## Purpose

Actual-versus-plan closes the weekly planning loop: record what was expected, observe what moved through cash, explain the difference and decide what to change. It must remain useful to an owner who is not a finance professional while retaining exact evidence for a CFO or accountant.

The system never treats an unmatched transaction as proof that a plan was wrong. It first establishes whether an actual cash movement belongs to a planned item, whether it is new activity, or whether more evidence is needed.

## Tier boundary

| Capability | Starter | Core | Growth | Advisory |
| --- | --- | --- | --- | --- |
| Monthly historical cash results | Included | Included | Included | Included |
| One saved 13-week base plan | Upgrade context | Included | Included | Included |
| Refresh starting cash and roll the base plan forward | — | Included | Included | Included |
| Durable actual-to-plan matching and weekly variance history | — | Upgrade context | Included | Included |
| Downside/upside cases and comparison | — | Upgrade context | Included | Included |
| CFO-reviewed mappings, commentary and sign-off | — | — | Optional workflow | Included or separately purchased service |

Accuracy, missing-data warnings, source labels and reconciliation failures are never withheld by tier. Core users can update a plan from current facts, but retained variance analytics and alternative cases are Growth capabilities.

## Separate records

The architecture keeps four concepts separate:

1. **Published plan evidence** — the immutable forecast version and planned cash items that existed before the period closed.
2. **Actual cash events** — provider-neutral cash movements imported from banking, accounting, a controlled spreadsheet or explicit manual entry.
3. **Match decisions** — allocations that connect one or more actual events to one or more planned items.
4. **Weekly review snapshots** — an immutable result describing coverage, reconciliation, variances and unresolved work for a closed forecast week.

Monthly financial history is not rewritten into transaction-level actuals. A monthly total cannot prove that a particular invoice, payroll or vendor payment occurred.

## Provider-neutral actual event

An actual cash event requires:

- account owner and reporting currency;
- stable source type, connection and source-event identity;
- cash date, nonnegative amount and inflow/outflow direction;
- normalized cash category when known;
- source-created and source-updated timestamps when supplied;
- ingestion batch, source payload fingerprint and lineage metadata;
- reversal or supersession relationship rather than destructive edits; and
- an explicit manual-entry marker when no provider evidence exists.

Idempotency is enforced by account, source connection and source-event identity. A corrected provider transaction creates a traceable revision or supersession; it does not silently alter a completed weekly review.

Actual events are distinct from bank balances. A balance is evidence for cash reconciliation, while events explain movement between balances.

## Match and allocation model

Matching must be many-to-many because ordinary cash activity includes partial receipts, installment payments, batched deposits, combined vendor withdrawals and split payroll transactions.

Each allocation records:

- published forecast version and planned item;
- actual cash event;
- allocated planned amount and allocated actual amount;
- resolution: `matched`, `cancelled`, `missed`, `unplanned` or `unresolved`;
- method: deterministic source identity, deterministic rule, user confirmed or advisor confirmed;
- confidence, rationale, creator and decision timestamp; and
- the matching-policy version.

The database prevents allocations from exceeding the applicable planned or actual amount, crossing accounts or currencies, or matching opposite cash directions. One atomic service operation locks the published version, affected actual events and allocations before saving a decision. Repeated requests use an idempotency key.

Provider reference equality may create an automatic match. Amount, date, description or counterparty similarity may create a suggestion only. Suggested matches remain unresolved until a deterministic identity rule or a person confirms them.

## Variance calculation

The pure engine consumes an immutable published plan plus validated allocations. It calculates exact differences first:

- amount variance = allocated actual amount minus allocated planned amount;
- timing variance = actual cash date minus planned cash date;
- combined amount and timing variance;
- planned cash that was cancelled or did not occur;
- actual cash that was not planned; and
- unresolved differences that cannot yet be described as performance.

Classification remains exact and deterministic. Materiality is a separate versioned policy used to prioritize owner guidance; it must not change the underlying variance. Thresholds may consider absolute value, percentage of the item, timing days, percentage of available cash and effect on the protected reserve.

For an outflow, a positive amount difference means more cash left than planned. Owner-facing language must translate the sign rather than expose accounting sign conventions. Funding, asset activity, debt principal, taxes and owner distributions remain separate from operating performance.

## Weekly close and reconciliation

A week can be reviewed when its end date has passed. A completed weekly review records:

- actual opening and closing available-cash balances when supplied;
- actual inflows and outflows supported by events;
- the explicit reconciliation difference;
- event and match coverage;
- unresolved, reversed or stale evidence;
- exact variance results and policy versions; and
- source snapshots and completion timestamp.

Opening balance plus actual inflows minus actual outflows must equal closing balance or display the unexplained difference. The system never inserts a balancing event automatically. A review can remain partial, but it cannot be labelled complete while material evidence is unresolved.

Later source corrections create a new review revision. Previously delivered guidance continues to reference the original immutable review.

## Owner guidance

The default surface answers four questions in plain language:

1. What happened differently from the plan?
2. Did it change the cash reserve or timing of a future risk?
3. What needs checking because the evidence is incomplete?
4. What is the next reasonable action?

Examples include confirming a late customer payment, checking an unexpected withdrawal, changing the date of a future bill, or updating the next plan. AI may explain only deterministic stored results and must cite the forecast version, weekly review and evidence used. It may not invent a match.

## Source precedence and integrations

INT-01 will define detailed provider precedence. This architecture establishes the boundary:

- bank evidence controls observed balance and cash movement;
- accounting evidence supplies invoice, bill and payment context;
- a user correction is an explicit audited override;
- conflicting sources remain visible until reconciled; and
- disconnecting a provider stops future synchronization without deleting retained evidence.

## Delivery sequence

1. **FORECAST-01E1 — architecture contract:** approve this record model, matching rules, tier boundary and invariants. No schema or customer behavior changes.
2. **FORECAST-01E2 — deterministic aggregation:** extend the pure engine from one-to-one examples to allocated many-to-many variance groups, materiality and weekly reconciliation. Use independently prepared fixtures and property tests.
3. **FORECAST-01E3 — storage and atomic review:** add actual events, allocations and immutable weekly review revisions with account isolation, least privilege, rollback and two-session contention tests.
4. **FORECAST-01E4 — Growth workflow:** add the owner review queue, plain-language weekly result and plan-roll-forward handoff. Manual actual entry may be used before INT-01.
5. **FORECAST-01E5 — cases:** add retained downside/upside assumptions and comparison against the shared base version.

This sequence does not add QuickBooks or banking ingestion. Those providers publish into the same actual-event boundary during INT-01.

## FORECAST-01E2 implementation

`lib/forecastVariance.ts` is the framework-independent actual-versus-plan engine. It accepts one closed forecast week, immutable planned items, provider-neutral actual events, explicit allocations, optional opening/closing balances and a versioned materiality policy. It performs no database, provider or UI work.

The engine:

- supports multiple actual events for one planned item and one actual event allocated across multiple planned items;
- rejects duplicate identifiers, unknown references, cross-currency matches, opposite cash directions and over-allocation;
- keeps unmatched amounts and explicit unresolved allocations out of performance conclusions;
- distinguishes on-plan, amount, timing, combined, unplanned, cancelled, missed and unresolved results;
- translates each resolved difference into its cash impact while retaining the exact amount and timing variance;
- reconciles opening cash plus all actual inflows and outflows to closing cash without inserting a balancing event;
- reports complete, partial or unknown evidence coverage;
- keeps exact classification separate from versioned amount, percentage and timing materiality thresholds; and
- identifies whether observed closing cash is below the protected reserve.

Fixtures cover partial receipts, batched withdrawals, unplanned/cancelled/missed activity, unreconciled cash, invalid allocations, timing materiality and deterministic allocation partitions. Storage, automatic matching suggestions, owner guidance and source ingestion remain later increments.

## FORECAST-01E3 implementation

`2026-10-27-forecast-variance-storage.sql` adds three account-scoped, owner-readable tables: immutable `cash_actual_events`, immutable `cash_forecast_reviews`, and each review revision's immutable `cash_forecast_review_allocations`. Existing monthly history and published forecast evidence are unchanged. Service-role callers can read these tables; only the three service-only RPCs can insert records. Anonymous access and authenticated writes/RPC execution are denied. The functions use fixed empty search paths and run as the migration owner; browser inputs must never be passed through an unauthenticated service route.

- `record_cash_actual_event` records source identity, currency, direction/category, amount, cash date, provider timestamps, batch, fingerprint, lineage and manual-entry status. An identical latest event replays without a write. Corrections require the expected current event ID and append a superseding revision; currency and business cannot change. The previous evidence remains available to old reviews.
- `cash_forecast_review_evidence` returns the active source revisions and immutable plan items for one closed, aligned week in the forecast's 13-week horizon. Its change token includes the review head. Reviews accept a superseded published plan as historical evidence.
- `prepareForecastReview` calls the E2 deterministic engine on that snapshot. `saveForecastReview` passes the prepared command through the explicit service-client adapter in `lib/db.ts`. Retrying an uncertain response reuses the exact prepared command and request key. Changed evidence requires recalculation with a new key.
- `save_cash_forecast_review` locks the owning business first, the published version second, then actual events in stable ID order. Ingestion takes the same business lock. Under those locks it verifies the change token, reference scope, directions, allocation totals, allocation precision and complete-review reconciliation/coverage. A stale source or review head fails with `40001`; reusing a key with a different payload fails. A review and all allocations commit together or roll back together.
- Every revision retains its predecessor, full source snapshot, observed balances, formula/matching/materiality versions, rationale, creator, creation time and exact engine output. The SQL boundary independently prohibits false complete coverage; the trusted server is responsible for calculating the detailed result with the versioned engine. Direct table writes are unavailable to service and browser roles.

The E2 engine currently compares planned and actual dates within the same reviewed week. Cross-week settlement allocation, automated provider matching, source freshness policy, public ingestion and the Growth review UI are not implemented here. Revision totals are checked within the replacement weekly snapshot; historical allocations remain evidence and are not counted again against the new revision.

### Validation and preview execution

The test suite boots a local PostgreSQL WASM runtime, applies the existing forecast migration, its permission repair and the new migration, then exercises the real PL/pgSQL functions with the real TypeScript engine. It covers revisions, exact retry, source correction, stale saves, over-allocation, wrong direction/account, premature close, false completeness, owner RLS, role privileges, immutable history and late-failure rollback. This is database execution, not a SQL text snapshot; it does not replace remote contention tests.

For remote preview validation, add these Git-ignored `.env.local` values:

```dotenv
PREVIEW_DATABASE_URL="<preview session-pooler PostgreSQL URI>"
PREVIEW_PROJECT_REF="<confirmed preview project reference>"
PREVIEW_TEST_ACCOUNT_A="<dedicated existing preview Auth UUID with a business and published plan>"
PREVIEW_TEST_ACCOUNT_B="<second dedicated existing preview Auth UUID>"
```

Run `node scripts/validate-forecast-preview.mjs --apply` to apply the migration if absent, execute `verify-forecast-variance-storage.sql` with rollback-only fixtures and test both writer operations against a held business lock from a second independent connection. Omit `--apply` to revalidate an installed migration. Credentials are never printed. The verifier does not mutate an existing plan; it uses an archived fixture forecast that rolls back. All contention probes roll back. The migration is additive and runs once; it is not a repeatable schema repair.

The code and migration remain on `preview`; production promotion is a separate release step.

On 27 October 2026 the migration was applied to the confirmed preview project. The rollback verifier passed storage, event replay, immutable source history, stale-head rejection, allocation limits, late-failure rollback, owner RLS and unrelated-account preservation. Two independent PostgreSQL sessions confirmed that both ingestion and review saves wait on the business lock held by a real ingestion operation; timed-out probes and the ingested fixture left no event after rollback. E3 validation passed 1,186 tests across 65 files, TypeScript, targeted lint and the production build. No production database changes were made. The subsequent E4 workflow is described below.

Release rollback means restoring the prior application and, if needed, revoking service-role execution on the three new RPCs. Keep the additive tables and retained evidence intact. Do not drop populated history as an application rollback.

## FORECAST-01E4 owner workflow

`/dashboard/forecast-review` provides the Growth/Advisory owner review queue. Cash Planning and the weekly plan link to it; the sidebar continues to group it under Cash Planning. Starter/Core see upgrade context and retain access to their existing planning tools. The page and `/api/forecast-review` both require a verified account, paid access and the new `forecast_variance` Growth feature. The API derives the account from the authenticated session before creating a service client. Growth/Advisory commercial availability flags remain unchanged.

The workflow has four steps:

1. Choose a complete seven-day week from a recent published base-plan version. The queue includes superseded versions, shows the newest saved review status and lists the latest 25 published versions. When no week has ended, explain why and show the first review date; do not manufacture a historical baseline.
2. Enter opening/closing available cash and the actual cash movements, with dates, directions, cash categories, descriptions and evidence notes. Empty balances remain unknown; explicit zero is accepted. Owners explicitly confirm that they checked the week's activity against their records. Transfers between included accounts and unpaid invoices/bills are excluded. Corrections require a reason, keep source identity and append a revision. The API supplies the manual source marker, currency, lineage fingerprint and account/business identity.
3. Add explicit user-confirmed decisions for matched, cancelled, missed, unplanned or unresolved activity. Each decision records its amounts, references and rationale. Multiple decisions support partial receipts and batched payments without automatic matching from similar amounts or descriptions. Recording/correcting a cash entry preserves unsaved match decisions and resets activity confirmation; obsolete references must be reviewed rather than silently removed.
4. Calculate on the server, inspect recorded cash totals, reconciliation, exact amount/date differences, unresolved amounts and reserve context, then save a complete or partial review. `owner-variance-1` uses a $100 absolute/10% proportional/2-day timing materiality policy with cent rounding. These thresholds prioritize guidance without hiding smaller differences. A complete owner review requires confirmed activity, resolved allocations and reconciled balances. A whole-week net cash effect remains unknown for partial/unknown coverage, while exact item-level differences remain visible.

Saving uses the E3 snapshot token and atomic RPC. The browser holds the exact write request after an interrupted response and disables edits until its retry resolves. On a replay, the server retrieves the original owner-scoped committed request/result rather than recalculating from a changed source or evaluation date. Reused keys with different content fail. A stale token returns a reload instruction while retaining unsaved form values. Request bodies are limited to 256 KiB and 1,000 decisions; money must be finite, nonnegative, no greater than 1e12 and representable to four decimal places.

Saved history displays the most recent 50 revisions using each revision's original source descriptions and materiality policy. Reading an older revision never replaces the current editable form. Later evidence is visibly marked as changed. The next-plan handoff links the owner-scoped saved review to `/dashboard/forecast?review=...`, explains any partial evidence and asks the owner to confirm current cash and future dates through the existing guided update flow. It does not automatically rewrite a published plan or monthly financial history.

No new SQL is required for E4. Automated tests cover API/page authorization, server calculations, manual entry/category validation and correction identity, replay after interrupted responses, invalid/stale allocations, zero/missing values, private-payload filtering, queue boundaries, form interactions and historical evidence. The existing preview rollback verifier and two-connection contention checks were rerun successfully. Read-only checks of the real Supabase adapters passed; the current dedicated test account has no closed week, so its real completed-week DTO probe was explicitly skipped. Completed-week owner interaction coverage uses controlled local fixtures. Owner acceptance in the hosted preview remains a separate check from these automated results.

Final E4 validation: 1,223 tests passed across 69 local test files, with the three remote-only probes skipped in the default run. Explicit preview execution passed two read-only probes and skipped the completed-week probe for the stated lack of eligible data. TypeScript, targeted ESLint and `next build` passed. Preview storage and actual two-session lock checks passed with all fixture writes rolled back.

For read-only adapter verification, run `$env:RUN_PREVIEW_REVIEW='1'; npx vitest run __tests__/forecastReviewPreview.test.ts` in PowerShell using the existing preview configuration. Normal `npm test` skips those remote-only checks. Cross-week settlement matching, provider synchronization, alternative cases and AI explanations remain later work.
