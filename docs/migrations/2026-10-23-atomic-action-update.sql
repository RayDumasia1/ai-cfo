-- Apply in PREVIEW first, after the action-capacity guard migration.
-- Installs an RPC only: no existing action/history rows or triggers are changed.
-- Apply this migration before deploying the application that calls the RPC.
BEGIN;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.actions'::regclass
    AND tgname = 'enforce_action_capacity' AND tgenabled = 'O' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'Apply the action-capacity guard migration first';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.update_action_with_audit(
  p_user_id uuid,
  p_action_id uuid,
  p_updates jsonb,
  p_audit_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_current public.actions%ROWTYPE;
  v_patch public.actions%ROWTYPE;
  v_result public.actions%ROWTYPE;
  v_key text;
BEGIN
  -- Use the session/RLS client, never a service-role or client-chosen identity.
  IF p_user_id IS NULL OR auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Unauthorized action account' USING ERRCODE = '42501';
  END IF;
  IF p_action_id IS NULL OR p_updates IS NULL OR jsonb_typeof(p_updates) IS DISTINCT FROM 'object'
     OR p_updates = '{}'::jsonb THEN
    RAISE EXCEPTION 'A non-empty action update is required' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_updates) AS fields(key) WHERE fields.key NOT IN (
    'name','description','goal_type','goal_value','goal_unit','status','due_date',
    'linked_alert_code','actual_impact','actual_impact_notes'
  )) THEN
    RAISE EXCEPTION 'Unsupported action update field' USING ERRCODE = '22023';
  END IF;

  IF p_updates ? 'name' AND (jsonb_typeof(p_updates->'name') <> 'string'
     OR length(btrim(p_updates->>'name')) = 0 OR length(p_updates->>'name') > 200) THEN
    RAISE EXCEPTION 'Invalid action name' USING ERRCODE = '22023';
  END IF;
  FOREACH v_key IN ARRAY ARRAY['description','linked_alert_code','actual_impact_notes'] LOOP
    IF p_updates ? v_key AND jsonb_typeof(p_updates->v_key) <> 'null' THEN
      IF jsonb_typeof(p_updates->v_key) <> 'string'
         OR length(p_updates->>v_key) > (CASE WHEN v_key = 'linked_alert_code' THEN 64 ELSE 500 END) THEN
        RAISE EXCEPTION 'Invalid action text' USING ERRCODE = '22023';
      END IF;
    END IF;
  END LOOP;
  FOREACH v_key IN ARRAY ARRAY['goal_value','actual_impact'] LOOP
    IF p_updates ? v_key AND jsonb_typeof(p_updates->v_key) NOT IN ('number','null') THEN
      RAISE EXCEPTION 'Invalid action number' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF p_updates ? 'goal_type' AND (jsonb_typeof(p_updates->'goal_type') <> 'string'
     OR p_updates->>'goal_type' NOT IN ('revenue_increase','expense_reduction','runway_improvement','risk_mitigation')) THEN
    RAISE EXCEPTION 'Invalid action goal type' USING ERRCODE = '22023';
  END IF;
  IF p_updates ? 'status' AND (jsonb_typeof(p_updates->'status') <> 'string'
     OR p_updates->>'status' NOT IN ('not_started','in_progress','completed')) THEN
    RAISE EXCEPTION 'Invalid action status' USING ERRCODE = '22023';
  END IF;
  IF p_updates ? 'goal_unit' AND jsonb_typeof(p_updates->'goal_unit') <> 'null' THEN
    IF jsonb_typeof(p_updates->'goal_unit') <> 'string' OR p_updates->>'goal_unit' NOT IN ('usd','percent','months','units') THEN
      RAISE EXCEPTION 'Invalid action goal unit' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_updates ? 'due_date' AND jsonb_typeof(p_updates->'due_date') <> 'null' THEN
    IF jsonb_typeof(p_updates->'due_date') <> 'string' OR (p_updates->>'due_date') !~ '^\d{4}-\d{2}-\d{2}$' THEN
      RAISE EXCEPTION 'Invalid action due date' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_audit_note IS NOT NULL AND length(p_audit_note) > 500 THEN
    RAISE EXCEPTION 'Action audit note is too long' USING ERRCODE = '22023';
  END IF;
  v_patch := jsonb_populate_record(NULL::public.actions, p_updates);

  SELECT a.* INTO v_current FROM public.actions a
    WHERE a.id = p_action_id AND a.user_id = p_user_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Action not found' USING ERRCODE = 'P0002';
  END IF;

  -- Only the allowlisted fields can change. Existing completion/timestamp and
  -- capacity triggers continue to run as part of this same UPDATE statement.
  UPDATE public.actions a SET
    name = CASE WHEN p_updates ? 'name' THEN v_patch.name ELSE a.name END,
    description = CASE WHEN p_updates ? 'description' THEN v_patch.description ELSE a.description END,
    goal_type = CASE WHEN p_updates ? 'goal_type' THEN v_patch.goal_type ELSE a.goal_type END,
    goal_value = CASE WHEN p_updates ? 'goal_value' THEN v_patch.goal_value ELSE a.goal_value END,
    goal_unit = CASE WHEN p_updates ? 'goal_unit' THEN v_patch.goal_unit ELSE a.goal_unit END,
    status = CASE WHEN p_updates ? 'status' THEN v_patch.status ELSE a.status END,
    due_date = CASE WHEN p_updates ? 'due_date' THEN v_patch.due_date ELSE a.due_date END,
    linked_alert_code = CASE WHEN p_updates ? 'linked_alert_code' THEN v_patch.linked_alert_code ELSE a.linked_alert_code END,
    actual_impact = CASE WHEN p_updates ? 'actual_impact' THEN v_patch.actual_impact ELSE a.actual_impact END,
    actual_impact_notes = CASE WHEN p_updates ? 'actual_impact_notes' THEN v_patch.actual_impact_notes ELSE a.actual_impact_notes END
  WHERE a.id = p_action_id AND a.user_id = p_user_id RETURNING a.* INTO v_result;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Action update was not applied' USING ERRCODE = 'P0002';
  END IF;

  IF v_current.status IS DISTINCT FROM v_result.status THEN
    INSERT INTO public.action_audit_log(action_id, user_id, old_status, new_status, note)
      VALUES(p_action_id, p_user_id, v_current.status, v_result.status, p_audit_note);
  END IF;
  -- No exception handler: an audit failure aborts the UPDATE as well.
  RETURN to_jsonb(v_result);
END;
$$;

REVOKE ALL ON FUNCTION public.update_action_with_audit(uuid,uuid,jsonb,text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_action_with_audit(uuid,uuid,jsonb,text) TO authenticated;
COMMENT ON FUNCTION public.update_action_with_audit(uuid,uuid,jsonb,text)
  IS 'Session/RLS-scoped atomic action update with locked old-status history. No swallowed audit failures.';
COMMIT;
