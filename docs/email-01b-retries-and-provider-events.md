# EMAIL-01B retries and provider delivery events

EMAIL-01B completes the feature-notification delivery lifecycle introduced in EMAIL-01A.

## Retry worker

Vercel calls `GET /api/cron/email-outbox` daily at 12:00 UTC while Elidan uses the Hobby plan. The route requires the exact `Authorization: Bearer <CRON_SECRET>` value before creating a service-role client. An atomic `FOR UPDATE SKIP LOCKED` RPC claims at most 20 due rows, increments attempts and recovers claims abandoned for more than 15 minutes.

Provider calls use the stable key `email-outbox/<row id>`. Retryable failures record delays of 5, 10, 20 and 40 minutes. Provider 4xx responses are permanent except 409 and 429. Exceptions, unconfirmed responses, 409, 429 and 5xx responses are retryable. No raw provider error, recipient, rendered HTML or secret is logged or stored.

The database records those backoff times, but Hobby invokes the recovery worker only once daily. Immediate inline delivery remains the normal path; a failed notification may therefore wait until the next daily run. Resend retains an idempotency key for 24 hours, so the daily prelaunch schedule cannot guarantee that every later attempt remains inside that provider window. Before customer launch, move to Vercel Pro and change the schedule to `*/10 * * * *`; the five-attempt sequence will then complete inside 24 hours. Vercel cron runs only on production deployments; preview validation invokes the protected endpoint manually.

The message is regenerated from bounded outbox fields. `user_id` and `created_at` are retained so a retry has the same payload as the initial idempotent request.

## Provider webhook

`POST /api/resend/webhook` reads the raw request body and verifies the Svix headers with `RESEND_WEBHOOK_SECRET` through the Resend SDK. It records delivered, delayed, bounced, complained, failed and suppressed events. Event IDs are deduplicated. Provider event time prevents an older delayed event from replacing a newer terminal outcome. An event received before its provider email ID is stored returns 500 so Resend retries it.

Accepted mail is not resent because of a delivery delay. A delay remains `sent`; delivery becomes `delivered`; bounce, complaint, suppression and final failure become terminal statuses.

## Deployment and configuration

1. Apply `2026-10-25-email-outbox-retries-and-events.sql` before application deployment.
2. Set a strong, independent `CRON_SECRET` in Vercel Preview and Production. Do not reuse a Supabase, Stripe or Resend key.
3. In Resend, create separate Preview and Production webhooks pointing to `/api/resend/webhook`. Subscribe to `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.complained`, `email.failed` and `email.suppressed`.
4. Store each webhook signing secret as `RESEND_WEBHOOK_SECRET` in its matching Vercel environment.
5. Never paste secret values into logs, tickets, chat or SQL.

The rollback verifier is preview-only. Production receives only the migration.
