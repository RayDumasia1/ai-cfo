-- PREVIEW ONLY. Replace both UUIDs, confirm preview, and run as postgres.
BEGIN;
DO $$
DECLARE
  preview_confirmed boolean := false;
  account_a uuid := NULL;
  account_b uuid := NULL;
  test_email text := 'email01b-'||txid_current()||'@example.invalid';
  registration jsonb; claimed public.email_outbox; event_result jsonb; other_before jsonb; target_id bigint;
BEGIN
  IF current_user<>'postgres' OR NOT preview_confirmed OR account_a IS NULL OR account_b IS NULL OR account_a=account_b THEN
    RAISE EXCEPTION 'Confirm PREVIEW and supply two distinct dedicated preview-account UUIDs; run as postgres';
  END IF;
  IF (SELECT count(*) FROM auth.users WHERE id IN(account_a,account_b))<>2 THEN RAISE EXCEPTION 'Both preview accounts must exist'; END IF;
  ASSERT NOT has_function_privilege('authenticated','public.claim_email_outbox_batch(integer)','EXECUTE');
  ASSERT NOT has_function_privilege('authenticated','public.record_email_delivery_event(text,text,text,timestamptz)','EXECUTE');
  ASSERT NOT has_table_privilege('authenticated','public.email_webhook_events','SELECT');
  SELECT jsonb_agg(to_jsonb(o) ORDER BY o.id) INTO other_before FROM public.email_outbox o WHERE o.email IN
    (SELECT email FROM public.notify_me WHERE user_id=account_b);
  EXECUTE 'SET LOCAL ROLE service_role';
  registration:=public.register_feature_notification(test_email,'tier_growth',account_a);
  target_id:=(registration->'outbox'->0->>'id')::bigint;
  UPDATE public.email_outbox SET next_attempt_at='1900-01-01T00:00:00Z' WHERE id=target_id;
  SELECT * INTO claimed FROM public.claim_email_outbox_batch(1) WHERE email=test_email LIMIT 1;
  ASSERT claimed.id=target_id AND claimed.status='sending' AND claimed.attempts=1 AND claimed.user_id=account_a;
  UPDATE public.email_outbox SET status='sent',provider_message_id='email_preview_'||claimed.id,locked_at=NULL WHERE id=claimed.id;
  event_result:=public.record_email_delivery_event('evt-delivered-'||claimed.id,'email_preview_'||claimed.id,'email.delivered',now());
  ASSERT event_result @> '{"matched":true,"applied":true}'::jsonb;
  event_result:=public.record_email_delivery_event('evt-delivered-'||claimed.id,'email_preview_'||claimed.id,'email.delivered',now());
  ASSERT event_result @> '{"matched":true,"applied":false}'::jsonb;
  event_result:=public.record_email_delivery_event('evt-old-delay-'||claimed.id,'email_preview_'||claimed.id,'email.delivery_delayed',now()-interval '1 minute');
  ASSERT event_result @> '{"matched":true,"applied":false}'::jsonb;
  ASSERT (SELECT status='delivered' AND delivered_at IS NOT NULL FROM public.email_outbox WHERE id=claimed.id);
  event_result:=public.record_email_delivery_event('evt-missing-'||claimed.id,'missing-provider-id','email.bounced',now());
  ASSERT event_result @> '{"matched":false,"applied":false}'::jsonb;
  EXECUTE 'RESET ROLE';
  ASSERT (SELECT jsonb_agg(to_jsonb(o) ORDER BY o.id) FROM public.email_outbox o WHERE o.email IN
    (SELECT email FROM public.notify_me WHERE user_id=account_b)) IS NOT DISTINCT FROM other_before;
END $$;
ROLLBACK;
