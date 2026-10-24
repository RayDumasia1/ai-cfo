-- PREVIEW ONLY. Never run in production, including on production test accounts.
-- Run AFTER 2026-10-23-financial-revision-history.sql.
-- Also apply 2026-10-24-preserve-settings-on-financial-clear.sql for the current clear policy.
-- Set preview_confirmed and TWO distinct dedicated preview-account UUIDs below.
-- Run this COMPLETE script through ROLLBACK. If it fails, run ROLLBACK before retrying.
BEGIN;

DO $$
DECLARE
  preview_confirmed boolean := false;
  account_a uuid := NULL; -- 'first-dedicated-preview-account-uuid'
  account_b uuid := NULL; -- 'second-dedicated-preview-account-uuid'
BEGIN
  IF NOT preview_confirmed OR current_user <> 'postgres' OR account_a IS NULL
     OR account_b IS NULL OR account_a = account_b THEN
    RAISE EXCEPTION 'Confirm PREVIEW and supply two distinct dedicated preview-account UUIDs; run as postgres';
  END IF;
  IF (SELECT count(*) FROM auth.users WHERE id IN (account_a, account_b)) <> 2 THEN
    RAISE EXCEPTION 'Both dedicated preview accounts must exist';
  END IF;
  IF current_setting('plpgsql.check_asserts') <> 'on' THEN
    RAISE EXCEPTION 'Verification requires plpgsql.check_asserts enabled';
  END IF;
  IF (SELECT atttypid FROM pg_attribute
      WHERE attrelid = 'public.financial_data_revisions'::regclass
        AND attname = 'source_data_version' AND NOT attisdropped) IS DISTINCT FROM 'text'::regtype::oid THEN
    RAISE EXCEPTION 'Apply 2026-10-23-financial-revision-version-text.sql first';
  END IF;
  PERFORM set_config('elidan.revision_verify_account', account_a::text, true);
  PERFORM set_config('elidan.revision_verify_other', account_b::text, true);
  ASSERT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class
    WHERE oid = 'public.financial_data_revisions'::regclass);
  ASSERT NOT has_table_privilege('anon', 'public.financial_data_revisions', 'SELECT');
  ASSERT NOT has_table_privilege('authenticated', 'public.financial_data_revisions', 'SELECT');
  ASSERT NOT has_table_privilege('authenticated', 'public.financial_data_revisions', 'INSERT');
  ASSERT NOT has_table_privilege('authenticated', 'public.financial_data_revisions', 'UPDATE');
  ASSERT NOT has_table_privilege('authenticated', 'public.financial_data_revisions', 'DELETE');
  ASSERT NOT has_function_privilege('authenticated', 'public.replace_financial_import(uuid,jsonb,jsonb,text)', 'EXECUTE');
  ASSERT NOT has_function_privilege('authenticated', 'public.clear_financial_data(uuid)', 'EXECUTE');
  ASSERT has_table_privilege('service_role', 'public.financial_data_revisions', 'SELECT');
  ASSERT NOT has_table_privilege('service_role', 'public.financial_data_revisions', 'UPDATE');
END;
$$;

CREATE FUNCTION pg_temp.revision_verification_snapshot(account_id uuid) RETURNS jsonb
LANGUAGE sql SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'profile', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.business_profiles t WHERE user_id = account_id),
    'months', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.month_date, t.id) FROM public.financial_months t WHERE user_id = account_id),
    'categories', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.month_date, t.id) FROM public.expense_categories t WHERE user_id = account_id),
    'imports', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.data_imports t WHERE user_id = account_id),
    'revisions', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.financial_data_revisions t WHERE user_id = account_id),
    'subscription', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.user_id) FROM public.subscriptions t WHERE user_id = account_id)
  );
$$;

CREATE FUNCTION pg_temp.fail_revision_verification() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  failure_mode text := current_setting('elidan.revision_verify_fail', true);
  affected_account uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN affected_account := OLD.user_id;
  ELSE affected_account := NEW.user_id;
  END IF;
  IF affected_account = current_setting('elidan.revision_verify_account')::uuid AND (
    (failure_mode = 'snapshot' AND TG_TABLE_NAME = 'financial_data_revisions' AND TG_OP = 'INSERT') OR
    (failure_mode IN ('prune', 'purge') AND TG_TABLE_NAME = 'financial_data_revisions' AND TG_OP = 'DELETE') OR
    (failure_mode = 'audit' AND TG_TABLE_NAME = 'data_imports' AND TG_OP = 'INSERT')
  ) THEN
    RAISE EXCEPTION 'Forced revision verification failure: %', failure_mode;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER verify_revision_insert BEFORE INSERT ON public.financial_data_revisions
  FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_revision_verification();
CREATE TRIGGER verify_revision_delete BEFORE DELETE ON public.financial_data_revisions
  FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_revision_verification();
CREATE TRIGGER verify_revision_audit BEFORE INSERT ON public.data_imports
  FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_revision_verification();

DO $$
DECLARE
  account_a uuid := current_setting('elidan.revision_verify_account')::uuid;
  account_b uuid := current_setting('elidan.revision_verify_other')::uuid;
  other_before jsonb := pg_temp.revision_verification_snapshot(account_b);
  subscription_before jsonb := pg_temp.revision_verification_snapshot(account_a)->'subscription';
  baseline jsonb;
  revision public.financial_data_revisions%ROWTYPE;
  first_revision_id bigint;
  failure_mode text;
  denied boolean;
  result jsonb;
  iteration integer;
BEGIN
  -- Keep account B populated so isolation checks cannot pass merely because
  -- a broad history deletion found nothing in the other account.
  EXECUTE 'SET LOCAL ROLE service_role';
  PERFORM public.replace_financial_import(account_b,
    '[{"month_date":"2026-08-01","closing_cash":444}]', '{}', 'other-account-seed.xlsx');
  PERFORM public.replace_financial_import(account_b,
    '[{"month_date":"2026-09-01","closing_cash":333}]', '{}', 'other-account-replace.xlsx');
  EXECUTE 'RESET ROLE';
  other_before := pg_temp.revision_verification_snapshot(account_b);

  EXECUTE 'SET LOCAL ROLE service_role';
  PERFORM public.clear_financial_data(account_a);
  PERFORM public.replace_financial_import(account_a,
    '[{"month_date":"2026-08-01","closing_cash":100},{"month_date":"2026-09-01","closing_cash":90}]',
    '{}', 'revision-seed.xlsx');
  EXECUTE 'RESET ROLE';
  ASSERT NOT EXISTS (SELECT 1 FROM public.financial_data_revisions WHERE user_id = account_a),
    'First import created an empty revision';
  UPDATE public.business_profiles SET business_name = 'Revision fixture',
    min_cash_reserve = 77, runway_warning_threshold = 8, runway_danger_threshold = 2,
    burn_rate_warning_pct = 0.105, invoice_overdue_days = 47,
    onboarding_completed_at = '2026-10-01T00:00:00Z', data_version = '2000-01-01T00:00:00Z'
    WHERE user_id = account_a;
  INSERT INTO public.expense_categories (user_id, business_id, month_date, category, amount)
    SELECT account_a, id, '2026-09-01', 'History fixture', 12
    FROM public.business_profiles WHERE user_id = account_a;
  baseline := pg_temp.revision_verification_snapshot(account_a);

  EXECUTE 'SET LOCAL ROLE service_role';
  result := public.replace_financial_import(account_a,
    '[{"month_date":"2026-10-01","closing_cash":70}]',
    '{"business_name":"Must not overwrite","min_cash_reserve":25000,"burn_rate_warning_pct":0.1}',
    'revision-replacement.xlsx');
  SELECT * INTO STRICT revision FROM public.financial_data_revisions WHERE user_id = account_a;
  EXECUTE 'RESET ROLE';
  first_revision_id := revision.id;
  ASSERT result = '{"replaced":true,"months_imported":1}'::jsonb;
  ASSERT revision.months_snapshot = baseline->'months', 'Old financial values/IDs/timestamps were not captured exactly';
  ASSERT revision.categories_snapshot = baseline->'categories', 'Old categories were lost';
  ASSERT revision.source_data_version = '2000-01-01T00:00:00Z';
  ASSERT revision.replaced_by_filename = 'revision-replacement.xlsx' AND revision.format_version = 1;
  ASSERT revision.profile_snapshot->>'business_name' = 'Revision fixture';
  ASSERT revision.profile_snapshot->'min_cash_reserve' = '77'::jsonb;
  ASSERT revision.profile_snapshot->'burn_rate_warning_pct' = '0.105'::jsonb;
  ASSERT (SELECT business_name = 'Revision fixture' AND min_cash_reserve = 77
    AND burn_rate_warning_pct = 0.105 FROM public.business_profiles WHERE user_id = account_a),
    'Settings preservation regressed';
  ASSERT (SELECT count(*) FROM public.financial_months WHERE user_id = account_a) = 1;
  ASSERT NOT EXISTS (SELECT 1 FROM public.expense_categories WHERE user_id = account_a);

  -- Version tokens must retain their exact text, not require date parsing.
  UPDATE public.business_profiles SET data_version = 'revision-token/not-a-timestamp'
    WHERE user_id = account_a;
  EXECUTE 'SET LOCAL ROLE service_role';
  PERFORM public.replace_financial_import(account_a,
    '[{"month_date":"2026-10-01","closing_cash":70}]', '{}', 'opaque-version.xlsx');
  EXECUTE 'RESET ROLE';
  ASSERT (SELECT source_data_version FROM public.financial_data_revisions
    WHERE user_id = account_a ORDER BY id DESC LIMIT 1) = 'revision-token/not-a-timestamp';

  UPDATE public.business_profiles SET data_version = NULL WHERE user_id = account_a;
  EXECUTE 'SET LOCAL ROLE service_role';
  PERFORM public.replace_financial_import(account_a,
    '[{"month_date":"2026-10-01","closing_cash":70}]', '{}', 'null-version.xlsx');
  EXECUTE 'RESET ROLE';
  ASSERT (SELECT source_data_version FROM public.financial_data_revisions
    WHERE user_id = account_a ORDER BY id DESC LIMIT 1) IS NULL;

  -- Snapshot insertion failure and a late success-audit failure must restore
  -- the exact same current rows, history, profile version, and import audit.
  FOREACH failure_mode IN ARRAY ARRAY['snapshot','audit'] LOOP
    baseline := pg_temp.revision_verification_snapshot(account_a);
    PERFORM set_config('elidan.revision_verify_fail', failure_mode, true);
    denied := false;
    BEGIN
      EXECUTE 'SET LOCAL ROLE service_role';
      PERFORM public.replace_financial_import(account_a,
        '[{"month_date":"2026-11-01","closing_cash":60}]', '{}', 'revision-must-rollback.xlsx');
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> ('Forced revision verification failure: ' || failure_mode) THEN RAISE; END IF;
      denied := true;
    END;
    EXECUTE 'RESET ROLE';
    ASSERT denied, 'Expected import failure did not occur';
    ASSERT pg_temp.revision_verification_snapshot(account_a) = baseline, 'Failed import left partial changes';
    PERFORM set_config('elidan.revision_verify_fail', '', true);
  END LOOP;

  -- More than 20 replacements retain the newest 20, not the oldest 20.
  EXECUTE 'SET LOCAL ROLE service_role';
  FOR iteration IN 1..22 LOOP
    PERFORM public.replace_financial_import(account_a,
      jsonb_build_array(jsonb_build_object('month_date','2026-10-01','closing_cash',iteration)),
      '{}', 'revision-retention.xlsx');
  END LOOP;
  EXECUTE 'RESET ROLE';
  ASSERT (SELECT count(*) FROM public.financial_data_revisions WHERE user_id = account_a) = 20;
  ASSERT NOT EXISTS (SELECT 1 FROM public.financial_data_revisions WHERE id = first_revision_id);
  ASSERT (SELECT months_snapshot->0->'closing_cash' FROM public.financial_data_revisions
    WHERE user_id = account_a ORDER BY id DESC LIMIT 1) = '21'::jsonb;
  ASSERT (SELECT months_snapshot->0->'closing_cash' FROM public.financial_data_revisions
    WHERE user_id = account_a ORDER BY id ASC LIMIT 1) = '2'::jsonb;

  -- Failure at retention or at the later audit must restore pruned rows too.
  baseline := pg_temp.revision_verification_snapshot(account_a);
  FOREACH failure_mode IN ARRAY ARRAY['prune','audit'] LOOP
    PERFORM set_config('elidan.revision_verify_fail', failure_mode, true);
    denied := false;
    BEGIN
      EXECUTE 'SET LOCAL ROLE service_role';
      PERFORM public.replace_financial_import(account_a,
        '[{"month_date":"2026-11-01","closing_cash":999}]', '{}', 'prune-must-rollback.xlsx');
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> ('Forced revision verification failure: ' || failure_mode) THEN RAISE; END IF;
      denied := true;
    END;
    EXECUTE 'RESET ROLE';
    ASSERT denied;
    ASSERT pg_temp.revision_verification_snapshot(account_a) = baseline, 'Failure lost pruned history or current data';
  END LOOP;

  -- Both early purge and late audit failures must leave Clear Data unchanged.
  FOREACH failure_mode IN ARRAY ARRAY['purge','audit'] LOOP
    PERFORM set_config('elidan.revision_verify_fail', failure_mode, true);
    denied := false;
    BEGIN
      EXECUTE 'SET LOCAL ROLE service_role';
      PERFORM public.clear_financial_data(account_a);
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> ('Forced revision verification failure: ' || failure_mode) THEN RAISE; END IF;
      denied := true;
    END;
    EXECUTE 'RESET ROLE';
    ASSERT denied;
    ASSERT pg_temp.revision_verification_snapshot(account_a) = baseline, 'Failed clear left partial changes';
  END LOOP;
  PERFORM set_config('elidan.revision_verify_fail', '', true);

  -- A browser JWT cannot read even its own retained financial history.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub',account_a,'role','authenticated')::text, true);
  denied := false;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM count(*) FROM public.financial_data_revisions;
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  EXECUTE 'RESET ROLE';
  ASSERT denied, 'Browser role gained history access';

  -- Validation errors must not create history, prune it, or replace data.
  PERFORM set_config('elidan.revision_verify_fail', '', true);
  denied := false;
  BEGIN
    EXECUTE 'SET LOCAL ROLE service_role';
    PERFORM public.replace_financial_import(account_a,
      '[{"month_date":"2026-11-01"},{"month_date":"2026-11-01"}]', '{}', 'duplicate-revision.xlsx');
  EXCEPTION WHEN SQLSTATE '22023' THEN denied := true;
  END;
  EXECUTE 'RESET ROLE';
  ASSERT denied;
  ASSERT pg_temp.revision_verification_snapshot(account_a) = baseline, 'Invalid import changed history or data';

  EXECUTE 'SET LOCAL ROLE service_role';
  PERFORM public.clear_financial_data(account_a);
  EXECUTE 'RESET ROLE';
  ASSERT NOT EXISTS (SELECT 1 FROM public.financial_data_revisions WHERE user_id = account_a);
  ASSERT NOT EXISTS (SELECT 1 FROM public.financial_months WHERE user_id = account_a);
  ASSERT NOT EXISTS (SELECT 1 FROM public.expense_categories WHERE user_id = account_a);
  ASSERT (pg_temp.revision_verification_snapshot(account_a)->'profile'->0) - ARRAY['data_version','updated_at']
    = (baseline->'profile'->0) - ARRAY['data_version','updated_at'],
    'Clear changed account details or settings';
  ASSERT pg_temp.revision_verification_snapshot(account_b) = other_before, 'Another account changed';
  ASSERT pg_temp.revision_verification_snapshot(account_a)->'subscription' = subscription_before, 'Billing changed';
END;
$$;

ROLLBACK;
