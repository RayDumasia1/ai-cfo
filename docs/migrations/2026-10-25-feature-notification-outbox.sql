-- Apply in PREVIEW first. Adds durable, deduplicated feature-notification work.
BEGIN;
CREATE TABLE IF NOT EXISTS public.email_outbox (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email text NOT NULL CHECK (length(email) BETWEEN 3 AND 254),
  feature text NOT NULL CHECK (length(feature) BETWEEN 1 AND 100),
  message_type text NOT NULL CHECK (message_type IN ('feature_customer_confirmation','feature_internal_notification')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  provider_message_id text,
  last_failure_reason text CHECK (last_failure_reason IN ('provider_rejected','unconfirmed','send_exception')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  UNIQUE(email,feature,message_type)
);
ALTER TABLE public.email_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_outbox FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_outbox FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.email_outbox TO service_role;
REVOKE ALL ON SEQUENCE public.email_outbox_id_seq FROM PUBLIC,anon,authenticated;
GRANT USAGE,SELECT ON SEQUENCE public.email_outbox_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.register_feature_notification(
  p_email text,p_feature text,p_user_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_inserted boolean; v_items jsonb;
BEGIN
  IF p_email IS NULL OR length(p_email) NOT BETWEEN 3 AND 254
     OR p_feature IS NULL OR length(p_feature) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid feature notification' USING ERRCODE='22023';
  END IF;
  WITH added AS (
    INSERT INTO public.notify_me(email,feature,user_id) VALUES(p_email,p_feature,p_user_id)
    ON CONFLICT(email,feature) DO NOTHING RETURNING 1
  ) SELECT EXISTS(SELECT 1 FROM added) INTO v_inserted;
  IF NOT v_inserted THEN RETURN jsonb_build_object('inserted',false,'outbox','[]'::jsonb); END IF;
  WITH queued AS (
    INSERT INTO public.email_outbox(email,feature,message_type) VALUES
      (p_email,p_feature,'feature_customer_confirmation'),
      (p_email,p_feature,'feature_internal_notification')
    ON CONFLICT(email,feature,message_type) DO NOTHING RETURNING id,message_type
  ) SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'message_type',message_type) ORDER BY id),'[]'::jsonb) INTO v_items FROM queued;
  RETURN jsonb_build_object('inserted',true,'outbox',v_items);
END; $$;
REVOKE ALL ON FUNCTION public.register_feature_notification(text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.register_feature_notification(text,text,uuid) TO service_role;
COMMIT;
