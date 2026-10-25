-- AUD-01: remove blanket browser-role privileges and harden account-scoped RPCs.
-- Apply in PREVIEW first. This changes grants/policies/functions only; no rows are rewritten.
BEGIN;

-- RLS does not protect TRUNCATE, REFERENCES or TRIGGER. Remove inherited blanket
-- privileges before granting only the operations used by authenticated flows.
REVOKE ALL PRIVILEGES ON TABLE
  public.action_audit_log, public.actions, public.business_profiles,
  public.cfo_calls, public.data_imports, public.dismissed_alerts,
  public.expense_categories, public.financial_months, public.notify_me,
  public.session_audit_log, public.subscriptions, public.usage_tracking
FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON public.business_profiles TO authenticated;
GRANT SELECT ON public.financial_months, public.expense_categories TO authenticated;
GRANT SELECT, INSERT ON public.data_imports TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dismissed_alerts TO authenticated;
GRANT SELECT ON public.subscriptions TO authenticated;
GRANT SELECT, UPDATE (warning_sent_at) ON public.usage_tracking TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.actions TO authenticated;
GRANT SELECT, INSERT ON public.action_audit_log TO authenticated;
GRANT SELECT, INSERT ON public.session_audit_log TO authenticated;
GRANT SELECT ON public.cfo_calls TO authenticated;

-- Owner policies apply only to authenticated sessions, not PUBLIC/anon.
ALTER POLICY "business_profiles: own rows" ON public.business_profiles TO authenticated;
ALTER POLICY "financial_months: own rows" ON public.financial_months TO authenticated;
ALTER POLICY "expense_categories: own rows" ON public.expense_categories TO authenticated;
ALTER POLICY "data_imports: own rows" ON public.data_imports TO authenticated;
ALTER POLICY "Users can delete own dismissed alerts" ON public.dismissed_alerts TO authenticated;
ALTER POLICY "Users can insert own dismissed alerts" ON public.dismissed_alerts TO authenticated;
ALTER POLICY "Users can read own dismissed alerts" ON public.dismissed_alerts TO authenticated;
ALTER POLICY "Users can update own dismissed alerts" ON public.dismissed_alerts TO authenticated;
ALTER POLICY "actions_delete_own" ON public.actions TO authenticated;
ALTER POLICY "actions_insert_own" ON public.actions TO authenticated;
ALTER POLICY "actions_select_own" ON public.actions TO authenticated;
ALTER POLICY "actions_update_own" ON public.actions TO authenticated;
ALTER POLICY "audit_log_insert_own" ON public.action_audit_log TO authenticated;
ALTER POLICY "audit_log_select_own" ON public.action_audit_log TO authenticated;
ALTER POLICY "Users read own CFO calls" ON public.cfo_calls TO authenticated;
ALTER POLICY "Users read own subscription" ON public.subscriptions TO authenticated;
ALTER POLICY "Users read own usage" ON public.usage_tracking TO authenticated;
ALTER POLICY "Users can view own audit logs" ON public.session_audit_log TO authenticated;

-- Service role bypasses RLS. Public unconditional policies only broaden access.
DROP POLICY IF EXISTS "Service role can update subscriptions" ON public.subscriptions;
DROP POLICY IF EXISTS "Users insert own subscription" ON public.subscriptions;
DROP POLICY IF EXISTS "Service role can manage usage" ON public.usage_tracking;
DROP POLICY IF EXISTS "Anyone can insert notify_me" ON public.notify_me;
DROP POLICY IF EXISTS "Users read own notify_me" ON public.notify_me;
DROP POLICY IF EXISTS "Service role can insert audit logs" ON public.session_audit_log;

CREATE POLICY usage_tracking_update_warning_own ON public.usage_tracking
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY session_audit_insert_own ON public.session_audit_log
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Fixed-value initialization replaces direct client inserts that could choose a
-- paid feature tier. A concurrent webhook row always wins ON CONFLICT.
CREATE OR REPLACE FUNCTION public.initialize_subscription()
RETURNS void
LANGUAGE plpgsql VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.subscriptions (user_id, plan, feature_tier, status)
    VALUES (v_user_id, 'starter', 'starter', 'active')
    ON CONFLICT (user_id) DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION public.initialize_subscription() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.initialize_subscription() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_active_action_count(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF p_user_id IS NULL OR auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Unauthorized action account' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT count(*)::integer FROM public.actions
    WHERE user_id = p_user_id AND status <> 'completed');
END;
$$;
REVOKE ALL ON FUNCTION public.get_active_action_count(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_active_action_count(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.increment_usage(
  p_user_id uuid, p_metric text, p_period_start timestamptz,
  p_period_end timestamptz, p_usage_limit integer
)
RETURNS void
LANGUAGE plpgsql VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_user_id IS NULL OR auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Unauthorized usage account' USING ERRCODE = '42501';
  END IF;
  IF p_metric NOT IN ('ask_cfo_questions', 'ai_insight_runs', 'actions_created')
     OR p_period_start IS NULL OR p_period_end IS NULL OR p_period_end <= p_period_start
     OR (p_usage_limit IS NOT NULL AND p_usage_limit < 0) THEN
    RAISE EXCEPTION 'Invalid usage increment' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.usage_tracking (
    user_id, metric, period_start, period_end, count, usage_limit
  ) VALUES (
    p_user_id, p_metric, p_period_start, p_period_end, 1, p_usage_limit
  )
  ON CONFLICT (user_id, metric, period_start)
  DO UPDATE SET count = public.usage_tracking.count + 1, updated_at = now();
END;
$$;
REVOKE ALL ON FUNCTION public.increment_usage(uuid,text,timestamptz,timestamptz,integer)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.increment_usage(uuid,text,timestamptz,timestamptz,integer)
  TO authenticated;

COMMIT;
