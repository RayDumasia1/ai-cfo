-- PREVIEW verification only. Read-only catalog checks; no test accounts required.
BEGIN;
DO $$
DECLARE
  required_columns text[] := ARRAY[
    'data_contract_version','source_type','accounting_basis','reporting_currency',
    'period_status','period_cutoff_date','opening_included_cash','closing_included_cash',
    'closing_unavailable_cash','cash_collected_from_customers','operating_cash_paid',
    'owner_draws_paid','debt_principal_paid','debt_interest_paid','investing_cash_paid',
    'investing_cash_received','debt_funding_received','owner_funding_received',
    'other_cash_inflows','other_cash_outflows','closing_taxes_reserved',
    'ar_expected_within_30_days','ap_due_within_30_days','available_credit',
    'credit_currently_drawn','lowest_observed_cash','cash_reconciliation_difference'
  ];
  required_constraints text[] := ARRAY[
    'financial_months_contract_version_check','financial_months_source_type_check',
    'financial_months_accounting_basis_check','financial_months_currency_check',
    'financial_months_period_status_check','financial_months_cutoff_check',
    'financial_months_v2_identity_check','financial_months_nonnegative_components_check',
    'financial_months_available_cash_check','financial_months_tax_reserve_check'
  ];
BEGIN
  IF to_regclass('public.financial_months') IS NULL THEN
    RAISE EXCEPTION 'financial_months is missing';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(required_columns) c
    WHERE NOT EXISTS (SELECT 1 FROM pg_attribute
      WHERE attrelid='public.financial_months'::regclass AND attname=c AND NOT attisdropped)) THEN
    RAISE EXCEPTION 'One or more DATA-01A columns are missing';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(required_constraints) c
    WHERE NOT EXISTS (SELECT 1 FROM pg_constraint
      WHERE conrelid='public.financial_months'::regclass AND conname=c AND convalidated)) THEN
    RAISE EXCEPTION 'One or more DATA-01A constraints are missing or unvalidated';
  END IF;
  IF (SELECT attgenerated FROM pg_attribute WHERE attrelid='public.financial_months'::regclass
      AND attname='cash_reconciliation_difference' AND NOT attisdropped) <> 's' THEN
    RAISE EXCEPTION 'cash_reconciliation_difference must be a stored generated column';
  END IF;
  IF (SELECT column_default IS NULL OR column_default NOT LIKE '%1%'
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name='financial_months' AND column_name='data_contract_version') THEN
    RAISE EXCEPTION 'Legacy contract default is not version 1';
  END IF;
  IF (SELECT column_default IS NULL OR column_default NOT LIKE '%legacy_spreadsheet%'
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name='financial_months' AND column_name='source_type') THEN
    RAISE EXCEPTION 'Legacy source default is missing';
  END IF;
  IF (SELECT column_default IS NULL OR column_default NOT LIKE '%unknown%'
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name='financial_months' AND column_name='period_status') THEN
    RAISE EXCEPTION 'Legacy period-status default is missing';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='financial_months'
      AND column_name IN ('data_contract_version','source_type','period_status') AND is_nullable <> 'NO') THEN
    RAISE EXCEPTION 'Legacy compatibility identity columns must be NOT NULL';
  END IF;
  IF to_regprocedure('public.import_reviewed_financial_data(uuid,jsonb,jsonb,text,text,text)') IS NULL
      OR to_regprocedure('public.import_financial_data(uuid,jsonb,jsonb,text,text)') IS NULL THEN
    RAISE EXCEPTION 'Existing reviewed import functions are missing';
  END IF;
END;
$$;
ROLLBACK;
