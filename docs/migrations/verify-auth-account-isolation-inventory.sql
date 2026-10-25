-- AUD-01: read-only inventory of Supabase authorization boundaries.
-- Run in the PREVIEW Supabase SQL editor as postgres and return all result sets.
-- This script performs no writes and does not display row data or secret values.

WITH expected(table_name, expected_access) AS (
  VALUES
    ('business_profiles', 'authenticated owner through RLS'),
    ('financial_months', 'authenticated owner through RLS'),
    ('expense_categories', 'authenticated owner through RLS'),
    ('data_imports', 'authenticated owner through RLS'),
    ('dismissed_alerts', 'authenticated owner through RLS'),
    ('subscriptions', 'authenticated owner read; privileged writes'),
    ('usage_tracking', 'authenticated owner through RLS/RPC'),
    ('actions', 'authenticated owner through RLS'),
    ('action_audit_log', 'authenticated owner read; controlled writes'),
    ('session_audit_log', 'controlled insert/read'),
    ('cfo_calls', 'authenticated owner read; privileged writes'),
    ('notify_me', 'privileged access only'),
    ('subscription_checkout_attempts', 'privileged access only'),
    ('founding_member_spots', 'privileged access only'),
    ('founding_member_corrections', 'database administrator only'),
    ('financial_data_revisions', 'privileged access only')
), grants AS (
  SELECT table_name, grantee,
    string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privileges
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated', 'service_role')
  GROUP BY table_name, grantee
)
SELECT e.table_name, e.expected_access,
  to_regclass(format('public.%I', e.table_name)) IS NOT NULL AS table_present,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced,
  COALESCE(a.privileges, '') AS anon_grants,
  COALESCE(u.privileges, '') AS authenticated_grants,
  COALESCE(s.privileges, '') AS service_role_grants
FROM expected e
LEFT JOIN pg_class c ON c.oid = to_regclass(format('public.%I', e.table_name))
LEFT JOIN grants a ON a.table_name = e.table_name AND a.grantee = 'anon'
LEFT JOIN grants u ON u.table_name = e.table_name AND u.grantee = 'authenticated'
LEFT JOIN grants s ON s.table_name = e.table_name AND s.grantee = 'service_role'
ORDER BY e.table_name;

SELECT tablename, policyname, roles, cmd, permissive, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'business_profiles', 'financial_months', 'expense_categories', 'data_imports',
    'dismissed_alerts', 'subscriptions', 'usage_tracking', 'actions',
    'action_audit_log', 'session_audit_log', 'cfo_calls', 'notify_me',
    'subscription_checkout_attempts', 'founding_member_spots',
    'founding_member_corrections', 'financial_data_revisions'
  )
ORDER BY tablename, cmd, policyname;

WITH expected(function_name) AS (
  VALUES
    ('increment_usage'),
    ('get_active_action_count'),
    ('update_action_with_audit'),
    ('replace_financial_import'),
    ('import_financial_data'),
    ('financial_import_review_state'),
    ('import_reviewed_financial_data'),
    ('clear_financial_data'),
    ('clear_financial_data_preserving_settings'),
    ('admin_correct_founding_membership')
)
SELECT e.function_name,
  p.oid IS NOT NULL AS function_present,
  pg_get_function_identity_arguments(p.oid) AS arguments,
  p.prosecdef AS security_definer,
  p.proconfig AS function_settings,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_execute
FROM expected e
LEFT JOIN pg_proc p ON p.pronamespace = 'public'::regnamespace AND p.proname = e.function_name
ORDER BY e.function_name, arguments;

SELECT conrelid::regclass::text AS table_name, conname,
  CASE contype WHEN 'p' THEN 'primary key' WHEN 'u' THEN 'unique'
    WHEN 'f' THEN 'foreign key' WHEN 'c' THEN 'check' ELSE contype::text END AS constraint_type,
  pg_get_constraintdef(oid) AS definition,
  convalidated
FROM pg_constraint
WHERE connamespace = 'public'::regnamespace
  AND conrelid::regclass::text IN (
    'business_profiles', 'financial_months', 'expense_categories', 'data_imports',
    'dismissed_alerts', 'subscriptions', 'usage_tracking', 'actions',
    'action_audit_log', 'session_audit_log', 'cfo_calls', 'notify_me'
  )
ORDER BY table_name, constraint_type, conname;
