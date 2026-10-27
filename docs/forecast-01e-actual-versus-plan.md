# FORECAST-01E actual-versus-plan architecture

**Status:** FORECAST-01E1 architecture approved 26 October 2026

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

Classification remains exact and deterministic. Materiality is a separate versioned policy used to prioritize owner guidance; it must not change the underlying variance. Thresholds may consider absolute value, percentage of the item, percentage of available cash and effect on the protected reserve.

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
