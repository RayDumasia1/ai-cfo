# DB-01B atomic AI usage consumption

DB-01B prepares quota enforcement for future Ask CFO and AI Insights endpoints. Those endpoints still return `501 FEATURE_NOT_IMPLEMENTED` before usage work, so this increment does not enable AI, consume customer allowances, send usage warnings, or introduce provider costs.

Preview validation completed on 25 October 2026. The sequential verifier passed, and two independent database sessions competing for the final hard-limit slot produced one committed count of 20 and one denial at 20. The verifier removed its temporary 2099 fixture.

Organization follow-on, 31 October 2026: [D4A](org-01d4-actions-and-budgets.md) records the future organization-budget conversion, preserving periods/counts/warning state and closing the legacy service writer at D4C cutover. That conversion is not installed. Historical `actions_created` counters are distinct from current active-action capacity. This document retains the deployed DB-01B contract; AI endpoints remain unavailable without usage consumption.

## Contract

`public.consume_usage(uuid,text,timestamptz,timestamptz,integer,boolean)` is service-role-only. Authenticated browser sessions cannot call it or the retired `increment_usage` function. A future API route must first authenticate the user, confirm email/subscription/feature access, derive the tier limit and overage policy on the server, and then use the service client with that validated user ID.

The function inserts a zero-count period row if needed, locks the unique `(user_id, metric, period_start)` row, and performs the decision and increment under that lock:

- Below the limit: increment once and return `allowed=true`, the committed count, and `throttled=false`.
- At/above a hard limit: do not increment; return `allowed=false` and the committed count.
- At/above an approved fair-use limit: increment once; return `allowed=true`, the committed count, and `throttled=true`.
- Unlimited tiers: application code skips tracking and does not call the RPC.

The returned `warning_sent_at` supports the existing best-effort Growth warning. Email delivery and warning bookkeeping remain outside the quota transaction. A failed email does not undo consumed usage; later eligible activity may retry the warning. Future AI delivery failure/refund semantics must be defined with the real provider workflow; this increment only makes admission and consumption atomic.

## Deployment and verification

1. Apply `2026-10-25-atomic-usage-consumption.sql` in preview.
2. Run all of `verify-atomic-usage-consumption.sql` as postgres after setting `preview_confirmed := true` and two dedicated preview UUIDs. It ends with `ROLLBACK`.
3. In two independent browser windows/browsers, run `verify-db01b-usage-limit-session-a.sql`, then immediately run session B while A sleeps. Session A commits one isolated January 2099 fixture; session B proves the competing request waits, receives a denial at count 20, verifies account B, and deletes the fixture.
4. If session B is interrupted, run the cleanup statement at the bottom of session A with account A's UUID.
5. Deploy the matching application to preview and confirm Ask CFO and AI Insights still return their existing coming-soon response without creating usage rows.
6. Apply only the migration—not either verifier—in production before promoting the application.

The sequential verifier checks role grants, hard-limit denial without increment, fair-use overage, metric separation, invalid inputs, and account isolation. The paired test proves the final-slot decision across two real connections. Application tests cover strict RPC result validation, exact arguments, database failures, hard-limit responses, committed overage counts, throttling, unlimited tiers, warning behavior, and continued zero usage for unavailable endpoints.

