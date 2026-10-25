-- Apply in PREVIEW first, then deploy the matching application.
-- This does not enable any AI endpoint or modify existing usage rows.
BEGIN;

DO $$ BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Run this migration as postgres';
  END IF;
  IF to_regclass('public.usage_tracking') IS NULL THEN
    RAISE EXCEPTION 'usage_tracking is required';
  END IF;
  IF to_regprocedure('public.increment_usage(uuid,text,timestamptz,timestamptz,integer)') IS NULL THEN
    RAISE EXCEPTION 'Apply the hardened client database access migration first';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.consume_usage(
  p_user_id uuid,
  p_metric text,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_usage_limit integer,
  p_allow_overage boolean
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_row public.usage_tracking%ROWTYPE;
  v_throttled boolean;
BEGIN
  IF p_user_id IS NULL OR p_metric NOT IN ('ask_cfo_questions','ai_insight_runs')
     OR p_period_start IS NULL OR p_period_end IS NULL OR p_period_end <= p_period_start
     OR p_usage_limit IS NULL OR p_usage_limit < 0 OR p_allow_overage IS NULL THEN
    RAISE EXCEPTION 'Invalid usage consumption request' USING ERRCODE = '22023';
  END IF;

  -- Insert zero first so every concurrent request locks the same row before it
  -- decides whether the next unit is allowed. The unique key is the lock boundary.
  INSERT INTO public.usage_tracking(
    user_id,metric,period_start,period_end,count,usage_limit
  ) VALUES (
    p_user_id,p_metric,p_period_start,p_period_end,0,p_usage_limit
  ) ON CONFLICT(user_id,metric,period_start) DO NOTHING;

  SELECT * INTO STRICT v_row FROM public.usage_tracking
    WHERE user_id = p_user_id AND metric = p_metric AND period_start = p_period_start
    FOR UPDATE;

  IF v_row.count >= p_usage_limit AND NOT p_allow_overage THEN
    -- Keep current trusted period metadata even when the request is denied.
    UPDATE public.usage_tracking SET
      period_end = p_period_end,
      usage_limit = p_usage_limit,
      updated_at = clock_timestamp()
    WHERE id = v_row.id
    RETURNING * INTO v_row;
    RETURN jsonb_build_object(
      'allowed',false,'throttled',false,'count',v_row.count,
      'usage_limit',v_row.usage_limit,'warning_sent_at',v_row.warning_sent_at
    );
  END IF;

  v_throttled := v_row.count >= p_usage_limit;
  UPDATE public.usage_tracking SET
    count = count + 1,
    period_end = p_period_end,
    usage_limit = p_usage_limit,
    updated_at = clock_timestamp()
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'allowed',true,'throttled',v_throttled,'count',v_row.count,
    'usage_limit',v_row.usage_limit,'warning_sent_at',v_row.warning_sent_at
  );
END;
$$;

ALTER FUNCTION public.consume_usage(uuid,text,timestamptz,timestamptz,integer,boolean)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.consume_usage(uuid,text,timestamptz,timestamptz,integer,boolean)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.consume_usage(uuid,text,timestamptz,timestamptz,integer,boolean)
  TO service_role;

-- Retire the browser-callable counter. The coordinated application uses only
-- consume_usage through a service client after authentication and feature gating.
REVOKE ALL ON FUNCTION public.increment_usage(uuid,text,timestamptz,timestamptz,integer)
  FROM PUBLIC,anon,authenticated,service_role;

COMMENT ON FUNCTION public.consume_usage(uuid,text,timestamptz,timestamptz,integer,boolean)
  IS 'Server-only atomic quota decision and consumption. Hard limits deny without incrementing; permitted overage increments and reports throttled.';

COMMIT;

