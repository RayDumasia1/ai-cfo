# ORG-01D financial ownership and write conversion

Updated 29 October 2026. **D1 inventory and requirements are complete; [D2 ownership storage](org-01d2-monthly-ownership.md) is implemented and database-validated in preview.** D2 owner preview acceptance passed on 29 October 2026; production D2 SQL completed successfully by owner report on 29 October 2026; the production SQL prerequisite for main promotion is complete; write authorization is still D3 work. A–C shipped in the platform release at `87964d4`; the owner confirmed production SQL execution and Vercel production deployment `7399976891` succeeded. [Parent architecture](org-01-organization-architecture.md), [C owner-read contract](org-01c-owner-reads.md), [active backlog](backlog.md).

## Why inventory precedes the migration

Adding an organization column does not authorize a writer. The current financial graph spans monthly imports, immutable displaced datasets, actions/capacity, weekly plans/cases/reviews and lifecycle hooks. Some writers are browser/RLS operations; others use trusted service RPCs or direct server DML. A single new route cannot close those other paths. D keeps the original owner as the only enabled actor until every interacting domain is converted and tested.

The [preview inventory tool](../scripts/inventory-organization-financial-preview.mjs) captures catalog columns, constraints, policies, triggers, role privileges, definition digests, candidate RPC calls, aggregate ownership counts and declared parent-edge consistency. It uses a checked preview connection and one `REPEATABLE READ READ ONLY` transaction. It executes no migrations, repairs, fixtures, grants or data mutations. Its optional local JSON report contains metadata/counts rather than raw row values or identities. Do not run this tool against production.

Definition-text references and call candidates are discovery aids, not a complete SQL dependency parser or proof of lock order. Repository callers and trigger/cascade behavior must be reviewed separately before each conversion. JSON checks currently cover archived monthly/category revision arrays; forecast/review payload lineage requires its own conversion tests.

## D1 preview evidence

The checked snapshot contained 19 scoped tables, 40 candidate functions and 24 declared parent edges within the inspected table set. B/C prerequisites and both live profile mappings were valid. There were no null legacy owners, owners without a current profile/live mapping, missing declared parents, or conflicting legacy owner/profile links in the inspected data. Null business links are a separate exception below. Counts are point-in-time evidence, not production facts or a claim that empty domains have passed runtime acceptance.

| Domain | Preview rows | Conversion consequence |
| --- | --- | --- |
| Profiles / subscriptions | 2 / 2 | Preserve profile and Stripe identities; subscription is still the selected owner's billing bridge, not the actor's arbitrary personal coverage. |
| Monthly financial records / categories | 15 / 0 | All existing monthly rows have the matching non-null business/profile owner. Empty category storage still needs populated negative fixtures. |
| Import audit / displaced revisions | 181 / 2 | Both are legacy-user scoped. The two revisions contain 14 embedded monthly rows with consistent owner/business scope; no embedded categories. Do not rewrite archived evidence to fabricate authorship or new sources. |
| Actions / action audit | 12 / 6 | All 12 actions have null `business_id`, despite valid legacy owners/mappings. Preserve them; review and explicitly scope any repair before action conversion. Do not silently guess or delete. |
| Weekly plans / versions / cash items | 1 / 17 / 67 | Parent links and owner scope are consistent. Preserve base/case lineage, version IDs, timestamps, calculation snapshots and immutable history. |
| Schedules, assumptions and assumption-item links | 0 each | Test populated recurring schedules and retained-case assumptions locally and with rolled-back preview fixtures before conversion. |
| Actual events, weekly reviews and allocations | 0 each | Inventory is not completed-week acceptance. Retain the separate 2 November owner check; test partial/complete/revised reviews with controlled fixtures. |
| Alert dismissals / usage periods | 5 / 0 | Dismissals become actor + organization state; usage becomes a shared organization budget only in its dedicated conversion. Do not reset or multiply counts. |

## Writer and locking closure

| Group | Existing entry points and dependencies | Required conversion boundary |
| --- | --- | --- |
| Monthly import/review/clear | `import_financial_data`, `import_financial_data_v2`, `import_reviewed_financial_data`, `financial_import_v2_is_unchanged`, `financial_import_review_state`, `replace_financial_import`, `clear_financial_data`, `clear_financial_data_preserving_settings`; direct import-audit insert and profile update helpers in `lib/db.ts` | Include legacy aliases, reviewed/no-op paths, revision capture/pruning and Clear Data. Existing mutations acquire the profile lock. Browser import-audit INSERT remains a real alternate path until explicitly constrained. |
| Profile and lifecycle | Existing authenticated profile INSERT/UPDATE RETURNING, B AFTER INSERT provisioning, service ensure and profile/Auth deletion cascades that detach/archive B identity | Preserve onboarding creation and settings. Include lifecycle coordination before introducing organization-first authorization locks; a profile-first delete/archive path can otherwise invert the new order. |
| Weekly plan graph | Draft creation, Core revision, publication, discard, case saving and review/event RPCs; direct draft/header/item/schedule DML in `/api/cash-forecast` | Include every Core/case/review writer sharing the graph. Draft discard currently begins with a version lock; service DML is not protected merely by adding checks to an RPC. Preserve existing business → forecast → source ordering until that complete group adopts its reviewed order. |
| Actions and capacity | Authenticated table DML, `update_action_with_audit`, action audit INSERT, forecast links, `enforce_action_capacity` subscription locking | Convert creation, reactivation, edits, deletion and audit together. Reconcile null business links first. Preserve limits, completion behavior and ordering; ACTION-01 remains unrelated backlog work. |
| Usage, billing and other dependencies | Service-only `consume_usage`; disabled legacy `increment_usage`; subscription webhook writes; parked `quickbooks_lifecycle` acquires a profile lock | Preserve one existing subscription, webhook behavior and current usage. A grant to one organization cannot unlock another. Parked provider code must remain compatible with shared profile locks without resuming integration work. |

The eventual converted order remains the parent contract: organization authorization roots in stable order → current principal/grant rows → business profile → billing/capacity → financial parent/child or usage. Do not add an organization lock inside a legacy writer after it has acquired its profile/resource lock. Before enabling that order, account/profile deletion and B detachment, all interacting RPC aliases, triggers and direct DML must have an explicit compatible protocol proven with independent sessions. D1 records this release gate; it does not assert the protocol is already implemented.

## Bounded delivery sequence

| Increment | Work and exit gate |
| --- | --- |
| **D1 — inventory and requirements** | Delivered here: reproducible read-only preview inventory, ownership exceptions, writer/lock closure and conversion acceptance. No schema or authorization change. |
| **D2 — monthly/import ownership expansion** | [Implemented/database-validated in preview 29 October](org-01d2-monthly-ownership.md): persisted organization scope on monthly/category/import/revision headers, immutable private scope identity, composite FKs and write guards. Existing fields/history, owner-only policies and deletion behavior are preserved. Real import/no-op/clear/rollback, profile provisioning/deletion and independent-session contention passed; 1,417 tests passed. Owner preview acceptance passed on 29 October 2026; production D2 SQL completed successfully by owner report on 29 October 2026; the production SQL prerequisite for main promotion is complete. No delegated authorization. |
| **D3 — monthly/import write authorization** | Convert review/no-op/import/clear and aliases, audit insertion, required profile/settings/lifecycle dependencies and owner resolver together. Recheck authenticated actor, selected target entitlement and current revisions under the reviewed lock protocol inside the authoritative transaction. Legacy service entry points cannot bypass it. Revalidate C reads against the persisted scope. No team access. |
| **D4 — actions, audit and shared budgets** | Explicitly reviewed legacy-action scope repair, organization-owned links, atomic audit/capacity and usage conversion. Preserve historical actor uncertainty and current-period counts. No dashboard ranking redesign or team assignment. |
| **D5 — complete weekly graph** | Convert Core draft/schedule/item/revision/publish/discard, Growth cases, actuals, matching/reviews and action references as one coherent ownership graph, possibly in storage/authorization substeps. Use composite organization/parent FKs and one writer order; preserve immutable evidence and exact calculations. |
| **D6 — cross-domain exit audit** | Cover remaining organization settings, actor-scoped dismissals, deletion/retention and all alternate/browser/service paths. Run adversarial revocation, concurrency, privilege and owner parity checks. Only then may E introduce direct teams under separately agreed seat/commercial rules; professional/advisor access remains later. |

## D2 implementation requirements

Keep existing resource/profile IDs, financial amounts, null/zero meaning, timestamps, source metadata and opaque profile `data_version`. A new `organization_id` is ownership metadata, not historical actor attribution. Preserve legacy `user_id` compatibility until its separate authorization conversion; never relabel it as proven `created_by`. New mutations can record a verified actor with an explicit provenance policy in D3.

Preflight the actual catalog, live B/C mapping, active graph and row scopes. Abort on unmapped, detached, foreign or ambiguous evidence; no repair in the schema install. Use parent/profile-qualified constraints and immutable ownership guards so an explicit wrong organization cannot be accepted by service DML. Preserve least-privilege grants and current RLS; no browser organization-metadata DML, new owner membership or automatic billing modification. Existing service imports and authenticated profile creation must still work without a browser-supplied organization ID.

The review-state RPC hashes `to_jsonb` of complete monthly/category rows. New scope fields will therefore invalidate an already-open review token once; the existing conflict/review-again behavior must handle that safely. This is acceptable migration invalidation, not a financial-value change or permission to accept stale authorization. Test new reviews, identical v2 no-op imports, update-months/replace-all, legacy import aliases, late-failure rollback and concurrent Clear Data. Do not rewrite the opaque token or calculation meaning merely to hide the schema change.

Old displaced JSON snapshots remain byte-for-byte unchanged. Future snapshot capture currently uses complete row JSON, so adding organization metadata introduces additional keys in newly captured snapshots. D2 must explicitly version or document this compatible additive evidence shape, verify old/new readers and preserve historical source/actor distinctions; it cannot silently assume an old restoration consumer accepts the change. No restore feature is enabled.

Empty-table success is insufficient. Seed two owners and populated monthly/category/import/revision fixtures in local SQL tests; exercise no-profile provisioning, null/foreign scope, wrong-organization supplied by a service caller, reassignment attempts, profile/Auth deletion and rollback. Preview checks use dedicated accounts and rollback-only fixtures. Replay/backfill semantics and production procedure must be reviewed with the concrete migration; never rerun older migrations or use preview verifiers in production.

## Running the D1 tool

With the existing Git-ignored preview configuration, run:

```powershell
node scripts/inventory-organization-financial-preview.mjs
# Optional local metadata report; keep it with confidential local references:
node scripts/inventory-organization-financial-preview.mjs --output docs/product-reference/org-01d1-preview-inventory.json
```

The tool requires matching `PREVIEW_DATABASE_URL`, `PREVIEW_PROJECT_REF` and, when present, the application Supabase URL. It fails on incomplete B/C mappings or unreadable/malformed inspected evidence, logs only the stage/code on failure, and rolls back its transaction. Keep passwords and report payloads out of chat. D2 must rerun this inventory against its current preview catalog and use its own migration preflight; D1 counts and definition digests are not a permanent authorization context.

## D1 validation

The completed tool passed the real preview inventory in read-only mode, syntax and targeted ESLint checks. Negative execution checks rejected `--apply` and a mismatched preview project before connecting. All 1,400 local regression tests passed across 87 files; four remote-only probes remained skipped. The changed contract/backlog/pattern references passed 52 relative-link checks, balanced code fences and `git diff --check`. No D1 migration or production action is required. These results validate the inventory increment, not the later D2–D6 enforcement or empty-domain mutation cases.
