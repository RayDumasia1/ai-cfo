-- Apply in preview before deploying BILL-01.
-- Stores no Stripe payload or customer data: only delivery identifiers and state.
CREATE TABLE IF NOT EXISTS public.stripe_webhook_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  object_id text,
  status text NOT NULL CHECK (status IN ('processing', 'completed', 'failed')),
  attempts integer NOT NULL DEFAULT 1 CHECK (attempts > 0),
  processing_started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stripe_webhook_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stripe_webhook_events TO service_role;

CREATE OR REPLACE FUNCTION public.claim_stripe_webhook_event(
  p_event_id text, p_event_type text, p_object_id text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE claimed boolean;
BEGIN
  IF p_event_id IS NULL OR length(p_event_id) = 0 OR length(p_event_id) > 255 OR
     p_event_type IS NULL OR length(p_event_type) = 0 OR length(p_event_type) > 255 OR
     length(COALESCE(p_object_id, '')) > 255 THEN
    RAISE EXCEPTION 'Invalid Stripe event identity';
  END IF;

  INSERT INTO public.stripe_webhook_events (event_id, event_type, object_id, status)
  VALUES (p_event_id, p_event_type, p_object_id, 'processing')
  ON CONFLICT (event_id) DO UPDATE SET
    status = 'processing', attempts = public.stripe_webhook_events.attempts + 1,
    processing_started_at = now(), completed_at = NULL, last_error = NULL,
    updated_at = now()
  WHERE public.stripe_webhook_events.status = 'failed'
     OR (public.stripe_webhook_events.status = 'processing'
         AND public.stripe_webhook_events.processing_started_at < now() - interval '5 minutes')
  RETURNING true INTO claimed;
  RETURN COALESCE(claimed, false);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_stripe_webhook_event(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_stripe_webhook_event(text, text, text) TO service_role;

NOTIFY pgrst, 'reload schema';
