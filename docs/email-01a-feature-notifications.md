# EMAIL-01A durable feature notifications

New notify-me registrations and their customer/internal email work are committed atomically. A duplicate registration is successful but enqueues nothing. The customer confirmation states that the user joined a notification list and that no purchase or plan change occurred.

`email_outbox` is server-only and stores routing fields, delivery state, bounded failure reason and provider acceptance ID. It never stores rendered HTML, secrets or raw provider errors. Inline delivery is best effort after commit: acceptance marks a row sent; rejection or interruption leaves durable work for EMAIL-01B retry processing. Registration success never depends on email delivery.

Deploy the migration before the matching application. In preview, run the rollback verifier with two dedicated account UUIDs, then run the paired session A/B verifier in separate SQL Editor windows to prove concurrent requests create one registration and exactly two messages. Validate a new registration, a duplicate registration and provider-failure behavior through the application. In production run only the migration.
