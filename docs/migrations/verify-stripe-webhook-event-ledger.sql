-- PREVIEW ONLY. Run the complete script; it always rolls back its test rows.
BEGIN;

DO $$
DECLARE preview_confirmed boolean := false; -- Set true only in preview.
BEGIN
  IF NOT preview_confirmed OR current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Confirm PREVIEW and run as postgres';
  END IF;

  ASSERT NOT has_table_privilege('anon', 'public.stripe_webhook_events', 'SELECT');
  ASSERT NOT has_table_privilege('authenticated', 'public.stripe_webhook_events', 'SELECT');
  ASSERT NOT has_function_privilege('anon', 'public.claim_stripe_webhook_event(text,text,text)', 'EXECUTE');
  ASSERT NOT has_function_privilege('authenticated', 'public.claim_stripe_webhook_event(text,text,text)', 'EXECUTE');

END $$;

SET LOCAL ROLE service_role;
DO $$
DECLARE test_event constant text := 'evt_bill01_preview_verifier';
BEGIN
  ASSERT public.claim_stripe_webhook_event(test_event, 'customer.subscription.updated', 'sub_test');
  ASSERT NOT public.claim_stripe_webhook_event(test_event, 'customer.subscription.updated', 'sub_test');
  UPDATE public.stripe_webhook_events SET status = 'failed' WHERE event_id = test_event;
  ASSERT public.claim_stripe_webhook_event(test_event, 'customer.subscription.updated', 'sub_test');
  UPDATE public.stripe_webhook_events SET status = 'completed', completed_at = now() WHERE event_id = test_event;
  ASSERT NOT public.claim_stripe_webhook_event(test_event, 'customer.subscription.updated', 'sub_test');
END $$;
RESET ROLE;

ROLLBACK;
