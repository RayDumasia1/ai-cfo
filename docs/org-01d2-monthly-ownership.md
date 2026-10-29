# ORG-01D2 monthly and import ownership storage

29 October 2026. Implemented and database-validated in preview. Hosted owner smoke acceptance and production migration/promotion remain pending. [D conversion plan](org-01d-financial-ownership-conversion.md), [parent architecture](org-01-organization-architecture.md).

## Storage contract

The [one-time migration](migrations/2026-10-29-organization-monthly-ownership.sql) adds non-null `organization_id` to `financial_months`, `expense_categories`, `data_imports` and `financial_data_revisions`. It backfills from the checked live B graph, preserves every preexisting field and installs immutable owner/organization guards plus validated composite foreign keys. Existing profile/financial IDs, timestamps, amounts, nulls/zeroes, source metadata, settings, opaque profile data version and archived JSON remain unchanged by installation.

`organization_private.financial_scopes` is a stable internal compatibility identity containing only organization, legacy profile and legacy owner IDs. It is seeded from verified live B mappings and provisioned atomically after B's profile-insert hook. It is append-only and unavailable to anon, authenticated and service-role clients. The helper functions have fixed empty search paths and no application-role execution grants. This metadata is integrity evidence, not a membership, export grant, payer link or delegated write capability.

Financial rows reference this immutable scope rather than taking foreign-key locks on B's mutable detachment row. Scope identity survives profile/Auth deletion. The existing profile foreign keys retain their `ON DELETE SET NULL` behavior: monthly/category legacy business links can detach when the profile is actually deleted while their persisted organization remains unchanged. Ordinary callers cannot null a live link or reassign its business, organization or legacy owner. Header-only import/revision ownership references the organization/legacy-owner pair; monthly/category rows additionally reference the organization/profile/owner tuple.

No actor is inferred from legacy ownership, no timestamps are fabricated and no financial calculation changes. Current RLS policies and existing grants remain in place. C owner monthly reads still return the same data, with the additive organization column. D3 must independently authorize and serialize writes; D2 automatic stamping does not close service-role or audit-insert authorization paths, or enable teams/advisors.

## Compatibility and edge behavior

Existing service import/review/no-op/Clear Data RPCs and compatibility aliases are unchanged. They continue to use their legacy lock order. The database stamps the verified scope on new rows when callers omit the new column. A supplied foreign organization, missing/foreign live business, or ownership reassignment fails closed. Initial imports and authenticated profile INSERT RETURNING provision both B and D2 identity atomically.

An already-open import review is invalidated once because the existing state hash includes full monthly/category row JSON. The existing stale-review response asks the owner to review again. A fresh review and identical v2 upload still produce a true no-op, without extra revisions/audit writes or changed data version. Old revision snapshots are untouched; newly captured complete-row snapshots contain the additional `organization_id` key under the existing `format_version=1`. This is an additive JSON evidence shape, not a changed financial formula or restore capability. New snapshots reject contradictory owner/profile/organization keys when those keys are supplied.

An audit INSERT without any current profile/live scope is denied instead of creating a profile implicitly. The existing failed-import logging catch keeps the original request response; its secondary audit may be unavailable until setup exists. Successful first imports create the profile before writing audit/history. Detached historical data cannot be silently reassigned to a newly created organization; any post-detachment history transfer or repair belongs to the later lifecycle conversion.

Clear Data retains the private identity and business settings while deleting the current financial dataset and displaced revisions, as before. Auth account deletion still cascades financial/audit/revision rows and retains archived organization identity. The 12 null-business actions, forecast/case/review graph, action ordering, usage, Stripe billing, tier flags and parked QuickBooks work are untouched.

## Preview and local evidence

The refreshed read-only inventory confirmed clean monthly/category scope and live B/C mappings before installation. The migration was applied once to preview on 29 October 2026. Its internal comparison and the [preview verifier](../scripts/validate-monthly-ownership-preview.mjs) confirmed all preexisting public-row fields remained identical, excluding only the four new organization columns. Current policies stayed identical; private schema/table/helper grants and validated ownership FKs passed catalog checks.

Both dedicated owners retained exact authenticated C read parity, with foreign selections and private-scope reads denied. Populated category/revision fixtures passed reviewed v2 import, semantic no-op, legacy replacement alias, update-months and Clear Data. Late audit failure rolled the entire mutation back. Authenticated profile INSERT RETURNING, first-import B+D2 provisioning and Auth deletion passed on real PostgreSQL. Independent sessions verified a profile delete was actually blocked by the financial writer via `pg_blocking_pids`, then completed after release; both transactions rolled back and all public row-value fingerprints matched. No committed test accounts or detached fixture scopes were left behind. Identity sequences may consume values during rolled-back import tests, as with the existing verifiers.

Local PGlite tests execute the real historical import migration chain plus B, C and D2. They cover exact preservation, zero/null data, service and browser scope checks, immutable ownership, composite-FK rejection independently of stamping, private privileges, stale/new reviews, no-op parity, old/new snapshot shape, profile/Auth deletion, first import, late-failure atomicity and failed-install rollback on inconsistent category scope. All **1,417** local tests passed across 88 files; four remote-only probes remained skipped. TypeScript, targeted ESLint and the production build passed.

To rerun preview checks, use `node scripts/validate-monthly-ownership-preview.mjs`. Use `--apply` only for a missing reviewed D2 install in the matching preview project. The driver skips an installed migration and rolls back all fixtures. Never point it at production or rerun an older migration to recreate functions.

## Owner preview acceptance

1. Open **Financial data** with the paid preview account. Confirm monthly history, values, missing/zero indicators and import history look unchanged; return to Dashboard and Cash planning.
2. Review the same known v2 workbook. An identical dataset should report no changes. If its contents differ from the current dataset, inspect the preview; do not expect a no-op merely because the filename matches.
3. If you choose to confirm a small known change in the test account, verify only the selected months change, the expected history entry appears and the rest of the account stays intact. Restore the known dataset afterward if needed. Automated rollback fixtures already covered destructive replace-all and Clear Data; no manual clearing of your test history is required.

## Production handoff and rollback

After preview acceptance, run only the reviewed D2 migration through the agreed production Supabase SQL Editor procedure, then report success before promotion. B/C storage/hooks, current reviewed-import/Clear Data functions and complete unambiguous ownership are prerequisites. The migration aborts on preexisting scope columns, partial/replayed installation, unexpected target triggers, unmapped historical owners or null/foreign monthly/category business links. Do not repair those records automatically; inspect and review the exception first. Locks and statement timeouts bound the install; any failure rolls back the whole expansion and restores trigger state.

There is no production backfill script separate from this atomic, checked expansion. Never run preview drivers/verifiers in production. Production catalog/runtime acceptance remains separate from owner-reported SQL completion. Existing application code is compatible with the additive schema; application rollback should retain the ownership columns, scope identities, FKs and guards rather than drop evidence or reverse the backfill. D2 grants no collaboration or new service authority. The next increment is D3 monthly/import write authorization and lifecycle coordination.
