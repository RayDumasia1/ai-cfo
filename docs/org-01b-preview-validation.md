# ORG-01B — implementation, preview evidence and rollout

28 October 2026. **Preview accepted by the owner on 28 October 2026.** The four internal tables and provisioning hooks are installed; both existing preview profiles have complete shadow mappings. The owner confirmed successful ORG-01B preview validation after the requested hosted smoke checks. No production database operation was performed. [Design/requirements](org-01b-shadow-organizations-design.md), [parent architecture](org-01-organization-architecture.md).

## Delivered behavior

- [Expansion migration](migrations/2026-10-28-organization-shadow-storage.sql) adds `organizations`, `organization_memberships`, `legacy_account_organizations` and `organization_access_events`, with non-routable customer-only scope, fixed one-owner membership, graph invariants and append-only history.
- One private routine handles the trusted profile INSERT hook and service-only `ensure_legacy_organization(uuid,uuid,uuid)`. Existing profile creation and its shadow records commit/roll back together. Exact replay returns original IDs/operation without updating names, timestamps, revisions or events.
- Browser roles have no new table reads/writes or function execution. Service role has SELECT plus the public ensure wrapper, with no direct metadata DML or private-schema access. The existing authenticated profile INSERT still works through the restricted trigger.
- Profile identity cannot be reassigned through `id/user_id` UPDATE. Routine profile, threshold, onboarding and data-version changes do not provision again. Existing timestamp behavior is retained.
- Profile removal detaches its mapping, archives its shadow organization and revokes its membership. Auth deletion nulls the live member reference while retaining original principal provenance and organization history. Historical profile UUID reuse cannot reactivate archived identity; a new profile UUID creates an independent shadow organization.
- No application route, financial RPC definition, financial ownership key, Stripe operation, Founding identity, usage counter, seat gate or sales flag changed. Customers still use the existing account-scoped model. QuickBooks remains parked.

The detach audit event uses explicit origin `profile_detach`; creation origins remain `profile_insert` and `service_ensure`. This refines the design vocabulary so a deletion is not incorrectly attributed to the earlier provisioning call.

## Preview operator commands

All commands below read credentials only from Git-ignored `.env.local` and guard the preview project reference and application Supabase URL. Ordinary output contains aggregate counts; SQL details and credentials are not printed.

```powershell
# Read-only plan/reconciliation; no installation or backfill.
node scripts/backfill-organizations-preview.mjs --plan

# Install only the missing new expansion, then backfill and verify legacy preservation.
node scripts/backfill-organizations-preview.mjs --apply --install

# Repeat safely on an installed preview; unchanged profiles produce no new records.
node scripts/backfill-organizations-preview.mjs --apply --batch-size=100

# Canonical rollback verifier plus real PostgreSQL multi-session race checks.
node scripts/validate-organizations-preview.mjs
```

The [operator](../scripts/backfill-organizations-preview.mjs) and [shared helpers](../scripts/organization-shadow-tools.mjs) bound batches to 1–500 profiles, default 100, acquire profile locks in UUID order, cap lock/query/batch duration, and allow only bounded retries of transaction-abort contention. Deadline termination closes the connection so unfinished work rolls back; restart is idempotent. Read-only fingerprints compare row counts and bounded row digests across all preexisting public tables. The digests detect row-value changes; they are not authorization signatures. Concurrent legitimate customer writes can change a before/after fingerprint and must be investigated before claiming preservation.

## Evidence

| Requirement | Result |
| --- | --- |
| Existing-account backfill | Two profiles → two active shadow organizations, zero unmapped profiles, zero conflicting live mappings. Both original profiles and all preexisting public-table row values preserved. |
| Exact repeat | Operator restart created zero records; direct ensure replay preserved full graph values, IDs, timestamps, revisions, winning operation and event count. |
| Privileges | Real authenticated own-profile INSERT works with private/trigger execution grants revoked. Wrapper/table/private-helper negative tests passed. Service direct metadata DML is denied. |
| Atomic failure handling | Local tests inject failure after each of the four inserts and during deferred commit validation. New profile and metadata roll back together; a preexisting profile survives failed backfill unchanged. |
| Existing creation paths | Real preview legacy/v2 imports, unchanged-review comparison, reviewed confirmation and Clear Data each provision valid identity for disposable profiles. Ordinary profile upserts/updates do not reprovision. |
| Deletion | Local and real preview Auth/profile deletion archive and tombstone correctly; an existing purchase FK can still block Auth deletion and roll back all attempted changes. |
| Concurrent first ensure | A second PostgreSQL session waits, then replays the committed winner. When the first rolls back, the waiter creates exactly once. |
| Concurrent missing-profile upsert | Two independent sessions return the same newly committed profile and one shadow graph. |
| Deletion races | Both profile-deletion/ensure orders and both Auth-cascade/ensure orders passed; no archived identity was regranted. |
| Interrupted backfill | A committed partial batch survives interruption; restart completes. A newly inserted lower UUID is mapped independently of the operator's earlier scan position. |
| Structural/security failures | Unexpected preinstallation trigger, stronger isolation, missing/foreign owner, invalid mode/role, extra member and immutable-history rewrites fail closed. Retry and hung-batch deadline tests passed. |

[Local schema tests](../__tests__/organizationShadowStorage.test.ts) and [operator tests](../__tests__/organizationBackfill.test.ts) cover 24 focused cases. The full regression suite passed **1,369 tests across 84 local files**, with four remote-only probes skipped, using `npm test -- --maxWorkers=2`. TypeScript, targeted ESLint and the production build passed.

### Fixture safety and limits of the evidence

The [canonical SQL verifier](migrations/verify-organization-shadow-storage.sql) creates disposable Auth/profile/import fixtures inside one transaction and rolls everything back; it never deletes real Auth accounts. The [multi-session verifier](../scripts/validate-organizations-preview.mjs) uses separately marked random, non-exposed schemas, including an isolated Auth-parent table. Some fixture commits are necessary for another session to observe a first provision/rollback winner. It runs a namespace-rewritten copy of the **same new migration**, not an older function migration, then removes only schemas whose generated name and ownership marker match that run. It does not change exposed PostgREST schemas.

After cleanup, canonical public-table row fingerprints, canonical shadow records and real Auth identity IDs match the pre-test state. All fixture schemas were removed. This is a deliberate refinement of the design's rollback-only fixture wording: canonical application mutations roll back; committed multi-session fixtures are confined to isolated schemas and dropped after marker checks. A failed cleanup reports an incomplete validation and requires inspection; it does not blindly delete an unknown schema.

The preview inventory found **nine legacy actions with null `business_id`** and no contradictory business-owner links in the inspected monthly/category/action/forecast/actual domains. These actions remain untouched. They are ownership-conversion work for ORG-01C/D, not evidence that every financial row already has organization ownership. No production catalog or production runtime acceptance was performed.

## Hosted owner smoke acceptance

The owner confirmed successful preview validation on 28 October 2026. This records user-reported acceptance, not an independent browser replay. The requested smoke checks covered these existing flows:

1. Reload Dashboard, Settings, Financial Data and Cash Planning; existing records and published plans/cases still load.
2. Save a business name or normal setting and confirm it persists after reload.
3. Open the normal spreadsheet review flow and confirm its review/results and existing data remain intact. There is no need to replace a real dataset solely to test B.

Automatic SQL/API-domain evidence above is distinct from this user-reported navigation acceptance. The November 2 completed-week review acceptance remains its separate scheduled task.

## Production plan — prepared, not executed

The preview operator and verifier intentionally refuse a different project. Do not repoint their environment guard to production. Production needs the reviewed [new expansion migration](migrations/2026-10-28-organization-shadow-storage.sql), followed by an explicitly authorized operational backfill; no preview verifier runs there. Its catalog preflight rejects unexpected ownership constraints, RLS or profile/Auth triggers rather than overwriting them.

After authorized production installation, the following is a **bounded operational backfill batch**, not a fixture/verifier. Run as the controlled database operator; repeat until no unmapped profiles remain. It creates only shadow metadata for existing profiles and never creates subscriptions or financial rows. Preserve the same strict error/repair policy; a conflicting mapping is not permission to rewrite ownership.

```sql
BEGIN ISOLATION LEVEL READ COMMITTED;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';
WITH batch AS MATERIALIZED (
  SELECT p.id, p.user_id
  FROM public.business_profiles p
  WHERE NOT EXISTS (
    SELECT 1 FROM public.legacy_account_organizations l
    WHERE l.legacy_business_profile_id = p.id
  )
  ORDER BY p.id
  LIMIT 100
  FOR UPDATE OF p
), operation AS MATERIALIZED (SELECT gen_random_uuid() AS id)
SELECT public.ensure_legacy_organization(b.id, b.user_id, o.id)
FROM batch b CROSS JOIN operation o
ORDER BY b.id;
COMMIT;
```

Capture read-only catalog/count evidence before installation and row-value comparisons appropriate to the production change window. Reconcile every live profile/mapping/owner and run the private read-only graph assertion as the database operator; total organization count alone is insufficient because archived shadows persist. Do not claim preservation if concurrent writes make the comparison inconclusive. A user confirming migration success is separate from independent catalog/runtime evidence.

If the insert hook causes an incident before collaboration exists, prepare a reviewed forward/incident migration for that hook only, record the gap interval, retain all new tables/history, repair and backfill any missed profiles, then re-establish the graph invariants. Do not rerun an older migration, drop organization history or enable shared access as a workaround. B's profile-first lock order and deletion hooks must be reviewed before C/D introduces organization-authorized writes.
