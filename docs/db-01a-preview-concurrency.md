# DB-01A preview concurrency verification

These tests verify the row-lock protocols already deployed for financial writes, reviewed confirmation, Clear Data, subscription writes, and action-slot acquisition. They install no functions, constraints, triggers, or policies. Every script ends with `ROLLBACK` and must only use two dedicated preview test accounts.

## Safety and preparation

1. Open the Supabase SQL Editor for the **preview** project in two independent browser windows, preferably separate browsers such as Chrome and Edge. Supabase's internal query tabs share one active Run control and cannot execute this test concurrently. Use `postgres` in both windows.
2. Choose two distinct dedicated preview Auth user UUIDs. Account A is the lock target; account B is used only for an isolation snapshot.
3. In each script, replace the UUID placeholders and set `preview_confirmed := true`.
4. Run each script as a complete file. If a script is interrupted or fails before its final statement, run `ROLLBACK;` in that same tab.
5. Never run these scripts in production. They are verifiers, not migrations.

The session-A scripts hold a row lock for 45 seconds. Start the paired session-B script promptly after session A reports that it is sleeping. Session B uses a two-second `lock_timeout`, catches the expected timeout inside a subtransaction, confirms no probe row survived, checks that account B did not change, and then rolls back.

## Test 1: financial-operation serialization

In SQL tab A, run `verify-db01a-financial-lock-session-a.sql`. While it sleeps, run `verify-db01a-financial-lock-session-b.sql` in tab B.

Expected tab-B result:

```text
PASS: import, reviewed confirmation, and Clear Data share the account profile lock.
```

This proves that all three operations wait on the same account profile row. It does not assert which operation should win; commit order determines the final operation order in normal use.

## Test 2: subscription and action-capacity serialization

After both Test 1 scripts finish, run `verify-db01a-subscription-action-lock-session-a.sql` in tab A. While it sleeps, run `verify-db01a-subscription-action-lock-session-b.sql` in tab B.

Expected tab-B result:

```text
PASS: subscription writes and action-slot acquisition share the subscription row lock.
```

This proves that a new active action waits for a concurrent subscription/tier write and that a concurrent subscription write waits on the same row. It complements the existing sequential capacity verifier; it does not replace capacity-boundary or authenticated RLS checks.

## Evidence and limits

A pass establishes actual two-connection waiting and timeout behavior in the current preview schema. Existing rollback verifiers continue to cover grants, role ownership, account scoping, capacity boundaries, stale-review behavior, and late-failure rollback. These paired tests do not verify future AI quota consumption, Stripe network ordering, or writers that bypass the documented lock protocols. Atomic AI quota consumption remains DB-01B.

Both paired tests passed in preview on 25 October 2026. Financial import, reviewed confirmation and Clear Data waited on the shared account profile lock. Subscription writes and active-action slot acquisition waited on the shared subscription row lock. The session-B assertions also confirmed that timed-out probes left no row and the unrelated account snapshot remained unchanged.

