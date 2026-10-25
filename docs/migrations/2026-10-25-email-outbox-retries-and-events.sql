-- EMAIL-01B: retry claims, bounded backoff state, and signed provider events.
ALTER TABLE public.email_outbox
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_event_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_event_type text,
  ADD COLUMN IF NOT EXISTS user_id uuid;

UPDATE public.email_outbox o SET user_id=n.user_id
FROM public.notify_me n
WHERE o.email=n.email AND o.feature=n.feature AND o.user_id IS NULL;

UPDATE public.email_outbox
SET next_attempt_at = COALESCE(next_attempt_at, updated_at, created_at)
WHERE status IN ('pending','failed');

ALTER TABLE public.email_outbox DROP CONSTRAINT IF EXISTS email_outbox_status_check;
ALTER TABLE public.email_outbox ADD CONSTRAINT email_outbox_status_check CHECK (status IN (
  'pending','sending','sent','delivered','failed','permanent_failed','bounced','complained','suppressed'
));
ALTER TABLE public.email_outbox DROP CONSTRAINT IF EXISTS email_outbox_last_failure_reason_check;
ALTER TABLE public.email_outbox ADD CONSTRAINT email_outbox_last_failure_reason_check CHECK (
  last_failure_reason IS NULL OR last_failure_reason IN (
    'provider_rejected','unconfirmed','send_exception','delivery_failed','bounced','complained','suppressed'
  )
);
ALTER TABLE public.email_outbox DROP CONSTRAINT IF EXISTS email_outbox_last_event_type_check;
ALTER TABLE public.email_outbox ADD CONSTRAINT email_outbox_last_event_type_check CHECK (
  last_event_type IS NULL OR last_event_type IN (
    'email.delivered','email.delivery_delayed','email.bounced','email.complained','email.failed','email.suppressed'
  )
);
CREATE INDEX IF NOT EXISTS email_outbox_retry_due_idx
  ON public.email_outbox(next_attempt_at,id) WHERE status IN ('pending','failed','sending');
CREATE UNIQUE INDEX IF NOT EXISTS email_outbox_provider_message_id_key
  ON public.email_outbox(provider_message_id) WHERE provider_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.email_webhook_events (
  event_id text PRIMARY KEY,
  provider_message_id text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'email.delivered','email.delivery_delayed','email.bounced','email.complained','email.failed','email.suppressed'
  )),
  event_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.email_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_webhook_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_webhook_events FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.email_webhook_events TO service_role;

CREATE OR REPLACE FUNCTION public.register_feature_notification(
  p_email text, p_feature text, p_user_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE v_inserted boolean; v_items jsonb;
BEGIN
  INSERT INTO public.notify_me(email,feature,user_id)
  VALUES(p_email,p_feature,p_user_id)
  ON CONFLICT(email,feature) DO NOTHING;
  GET DIAGNOSTICS v_inserted=ROW_COUNT;
  IF NOT v_inserted THEN RETURN jsonb_build_object('inserted',false,'outbox','[]'::jsonb); END IF;
  WITH inserted AS (
    INSERT INTO public.email_outbox(email,feature,message_type,next_attempt_at,user_id) VALUES
      (p_email,p_feature,'feature_customer_confirmation',now(),p_user_id),
      (p_email,p_feature,'feature_internal_notification',now(),p_user_id)
    RETURNING id,message_type,created_at
  ) SELECT jsonb_agg(jsonb_build_object('id',id,'message_type',message_type,'created_at',created_at)
      ORDER BY message_type) INTO v_items FROM inserted;
  RETURN jsonb_build_object('inserted',true,'outbox',v_items);
END $$;
REVOKE ALL ON FUNCTION public.register_feature_notification(text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.register_feature_notification(text,text,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_email_outbox_batch(p_limit integer DEFAULT 20)
RETURNS SETOF public.email_outbox LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
  IF p_limit < 1 OR p_limit > 100 THEN RAISE EXCEPTION 'Invalid batch size'; END IF;
  RETURN QUERY
  WITH candidates AS (
    SELECT id FROM public.email_outbox
    WHERE attempts < 5 AND (
      (status IN ('pending','failed') AND COALESCE(next_attempt_at,created_at) <= now())
      OR (status='sending' AND locked_at < now()-interval '15 minutes')
    )
    ORDER BY COALESCE(next_attempt_at,created_at),id
    FOR UPDATE SKIP LOCKED LIMIT p_limit
  )
  UPDATE public.email_outbox o SET
    status='sending', attempts=o.attempts+1, locked_at=now(), updated_at=now()
  FROM candidates c WHERE o.id=c.id
  RETURNING o.*;
END $$;
REVOKE ALL ON FUNCTION public.claim_email_outbox_batch(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_email_outbox_batch(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.record_email_delivery_event(
  p_event_id text, p_provider_message_id text, p_event_type text, p_event_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE v_row_id bigint; v_inserted boolean; v_status text; v_reason text;
BEGIN
  IF p_event_id IS NULL OR length(p_event_id)>255 OR p_provider_message_id IS NULL
     OR length(p_provider_message_id)>255 OR p_event_type NOT IN (
       'email.delivered','email.delivery_delayed','email.bounced','email.complained','email.failed','email.suppressed'
     ) OR p_event_at IS NULL THEN RAISE EXCEPTION 'Invalid email delivery event'; END IF;
  SELECT id INTO v_row_id FROM public.email_outbox WHERE provider_message_id=p_provider_message_id FOR UPDATE;
  IF v_row_id IS NULL THEN RETURN jsonb_build_object('matched',false,'applied',false); END IF;
  INSERT INTO public.email_webhook_events(event_id,provider_message_id,event_type,event_at)
  VALUES(p_event_id,p_provider_message_id,p_event_type,p_event_at) ON CONFLICT(event_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted=ROW_COUNT;
  IF NOT v_inserted THEN RETURN jsonb_build_object('matched',true,'applied',false); END IF;
  IF p_event_type='email.delivered' THEN v_status:='delivered'; v_reason:=NULL;
  ELSIF p_event_type='email.delivery_delayed' THEN v_status:='sent'; v_reason:=NULL;
  ELSIF p_event_type='email.bounced' THEN v_status:='bounced'; v_reason:='bounced';
  ELSIF p_event_type='email.complained' THEN v_status:='complained'; v_reason:='complained';
  ELSIF p_event_type='email.suppressed' THEN v_status:='suppressed'; v_reason:='suppressed';
  ELSE v_status:='permanent_failed'; v_reason:='delivery_failed'; END IF;
  UPDATE public.email_outbox SET
    status=v_status,
    delivered_at=CASE WHEN p_event_type='email.delivered' THEN p_event_at ELSE delivered_at END,
    last_failure_reason=v_reason,
    last_event_at=p_event_at,last_event_type=p_event_type,updated_at=now()
  WHERE id=v_row_id AND (last_event_at IS NULL OR p_event_at>=last_event_at)
    AND NOT (p_event_type='email.delivery_delayed' AND status IN ('delivered','bounced','complained','suppressed','permanent_failed'));
  RETURN jsonb_build_object('matched',true,'applied',FOUND);
END $$;
REVOKE ALL ON FUNCTION public.record_email_delivery_event(text,text,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_email_delivery_event(text,text,text,timestamptz) TO service_role;
