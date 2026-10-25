-- DATA-01A: additive financial-month contract. Apply in PREVIEW first.
-- This migration does not reinterpret or copy legacy financial amounts.
-- Existing rows remain contract version 1 and current import RPCs remain valid.
BEGIN;

ALTER TABLE public.financial_months
  ADD COLUMN IF NOT EXISTS data_contract_version smallint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'legacy_spreadsheet',
  ADD COLUMN IF NOT EXISTS accounting_basis text,
  ADD COLUMN IF NOT EXISTS reporting_currency text,
  ADD COLUMN IF NOT EXISTS period_status text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS period_cutoff_date date,
  ADD COLUMN IF NOT EXISTS opening_included_cash numeric,
  ADD COLUMN IF NOT EXISTS closing_included_cash numeric,
  ADD COLUMN IF NOT EXISTS closing_unavailable_cash numeric,
  ADD COLUMN IF NOT EXISTS cash_collected_from_customers numeric,
  ADD COLUMN IF NOT EXISTS operating_cash_paid numeric,
  ADD COLUMN IF NOT EXISTS owner_draws_paid numeric,
  ADD COLUMN IF NOT EXISTS debt_principal_paid numeric,
  ADD COLUMN IF NOT EXISTS debt_interest_paid numeric,
  ADD COLUMN IF NOT EXISTS investing_cash_paid numeric,
  ADD COLUMN IF NOT EXISTS investing_cash_received numeric,
  ADD COLUMN IF NOT EXISTS debt_funding_received numeric,
  ADD COLUMN IF NOT EXISTS owner_funding_received numeric,
  ADD COLUMN IF NOT EXISTS other_cash_inflows numeric,
  ADD COLUMN IF NOT EXISTS other_cash_outflows numeric,
  ADD COLUMN IF NOT EXISTS closing_taxes_reserved numeric,
  ADD COLUMN IF NOT EXISTS ar_expected_within_30_days numeric,
  ADD COLUMN IF NOT EXISTS ap_due_within_30_days numeric,
  ADD COLUMN IF NOT EXISTS available_credit numeric,
  ADD COLUMN IF NOT EXISTS credit_currently_drawn numeric,
  ADD COLUMN IF NOT EXISTS lowest_observed_cash numeric;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'financial_months_contract_version_check'
      AND conrelid = 'public.financial_months'::regclass) THEN
    ALTER TABLE public.financial_months ADD CONSTRAINT financial_months_contract_version_check
      CHECK (data_contract_version IN (1,2));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'financial_months_source_type_check'
      AND conrelid = 'public.financial_months'::regclass) THEN
    ALTER TABLE public.financial_months ADD CONSTRAINT financial_months_source_type_check
      CHECK (source_type IN ('legacy_spreadsheet','spreadsheet','quickbooks','manual','other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'financial_months_accounting_basis_check'
      AND conrelid = 'public.financial_months'::regclass) THEN
    ALTER TABLE public.financial_months ADD CONSTRAINT financial_months_accounting_basis_check
      CHECK (accounting_basis IS NULL OR accounting_basis IN ('cash','accrual','mixed','unknown'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'financial_months_currency_check'
      AND conrelid = 'public.financial_months'::regclass) THEN
    ALTER TABLE public.financial_months ADD CONSTRAINT financial_months_currency_check
      CHECK (reporting_currency IS NULL OR reporting_currency ~ '^[A-Z]{3}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'financial_months_period_status_check'
      AND conrelid = 'public.financial_months'::regclass) THEN
    ALTER TABLE public.financial_months ADD CONSTRAINT financial_months_period_status_check
      CHECK (period_status IN ('complete','partial','unknown'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'financial_months_cutoff_check'
      AND conrelid = 'public.financial_months'::regclass) THEN
    ALTER TABLE public.financial_months ADD CONSTRAINT financial_months_cutoff_check CHECK (
      (period_status = 'partial' AND period_cutoff_date IS NOT NULL
        AND period_cutoff_date >= month_date
        AND period_cutoff_date < (month_date + interval '1 month'))
      OR (period_status IN ('complete','unknown') AND period_cutoff_date IS NULL)
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'financial_months_v2_identity_check'
      AND conrelid = 'public.financial_months'::regclass) THEN
    ALTER TABLE public.financial_months ADD CONSTRAINT financial_months_v2_identity_check CHECK (
      data_contract_version = 1 OR (
        source_type <> 'legacy_spreadsheet' AND reporting_currency IS NOT NULL
        AND accounting_basis IS NOT NULL AND period_status <> 'unknown'
        AND opening_included_cash IS NOT NULL AND closing_included_cash IS NOT NULL
        AND closing_unavailable_cash IS NOT NULL
        AND cash_collected_from_customers IS NOT NULL AND operating_cash_paid IS NOT NULL
        AND owner_draws_paid IS NOT NULL AND debt_principal_paid IS NOT NULL
        AND debt_interest_paid IS NOT NULL AND investing_cash_paid IS NOT NULL
        AND investing_cash_received IS NOT NULL AND debt_funding_received IS NOT NULL
        AND owner_funding_received IS NOT NULL AND other_cash_inflows IS NOT NULL
        AND other_cash_outflows IS NOT NULL
      )
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'financial_months_nonnegative_components_check'
      AND conrelid = 'public.financial_months'::regclass) THEN
    ALTER TABLE public.financial_months ADD CONSTRAINT financial_months_nonnegative_components_check CHECK (
      (closing_unavailable_cash IS NULL OR closing_unavailable_cash >= 0)
      AND (cash_collected_from_customers IS NULL OR cash_collected_from_customers >= 0)
      AND (operating_cash_paid IS NULL OR operating_cash_paid >= 0)
      AND (owner_draws_paid IS NULL OR owner_draws_paid >= 0)
      AND (debt_principal_paid IS NULL OR debt_principal_paid >= 0)
      AND (debt_interest_paid IS NULL OR debt_interest_paid >= 0)
      AND (investing_cash_paid IS NULL OR investing_cash_paid >= 0)
      AND (investing_cash_received IS NULL OR investing_cash_received >= 0)
      AND (debt_funding_received IS NULL OR debt_funding_received >= 0)
      AND (owner_funding_received IS NULL OR owner_funding_received >= 0)
      AND (other_cash_inflows IS NULL OR other_cash_inflows >= 0)
      AND (other_cash_outflows IS NULL OR other_cash_outflows >= 0)
      AND (closing_taxes_reserved IS NULL OR closing_taxes_reserved >= 0)
      AND (ar_expected_within_30_days IS NULL OR ar_expected_within_30_days >= 0)
      AND (ap_due_within_30_days IS NULL OR ap_due_within_30_days >= 0)
      AND (available_credit IS NULL OR available_credit >= 0)
      AND (credit_currently_drawn IS NULL OR credit_currently_drawn >= 0)
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'financial_months_available_cash_check'
      AND conrelid = 'public.financial_months'::regclass) THEN
    ALTER TABLE public.financial_months ADD CONSTRAINT financial_months_available_cash_check CHECK (
      closing_included_cash IS NULL OR closing_unavailable_cash IS NULL
      OR closing_unavailable_cash <= greatest(closing_included_cash,0)
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'financial_months_tax_reserve_check'
      AND conrelid = 'public.financial_months'::regclass) THEN
    ALTER TABLE public.financial_months ADD CONSTRAINT financial_months_tax_reserve_check CHECK (
      closing_taxes_reserved IS NULL OR closing_unavailable_cash IS NULL
      OR closing_taxes_reserved <= closing_unavailable_cash
    );
  END IF;
END;
$$;

ALTER TABLE public.financial_months
  ADD COLUMN IF NOT EXISTS cash_reconciliation_difference numeric GENERATED ALWAYS AS (
    CASE WHEN opening_included_cash IS NULL OR closing_included_cash IS NULL
      OR cash_collected_from_customers IS NULL OR operating_cash_paid IS NULL
      OR owner_draws_paid IS NULL OR debt_principal_paid IS NULL OR debt_interest_paid IS NULL
      OR investing_cash_paid IS NULL OR investing_cash_received IS NULL
      OR debt_funding_received IS NULL OR owner_funding_received IS NULL
      OR other_cash_inflows IS NULL OR other_cash_outflows IS NULL
    THEN NULL ELSE
      closing_included_cash - opening_included_cash - (
        cash_collected_from_customers - operating_cash_paid - owner_draws_paid
        - debt_principal_paid - debt_interest_paid - investing_cash_paid
        + investing_cash_received + debt_funding_received + owner_funding_received
        + other_cash_inflows - other_cash_outflows
      )
    END
  ) STORED;

COMMENT ON COLUMN public.financial_months.data_contract_version IS '1 = legacy ambiguous workbook fields; 2 = classified cash-health contract.';
COMMENT ON COLUMN public.financial_months.source_type IS 'Origin of this monthly record; provider adapters must preserve the shared contract.';
COMMENT ON COLUMN public.financial_months.accounting_basis IS 'Source reporting basis. Does not change cash-flow classifications.';
COMMENT ON COLUMN public.financial_months.reporting_currency IS 'ISO 4217 reporting currency for this monthly record.';
COMMENT ON COLUMN public.financial_months.period_status IS 'Whether the reporting month is complete, partial, or legacy/unknown.';
COMMENT ON COLUMN public.financial_months.period_cutoff_date IS 'Last included date for a partial month; null for complete or unknown periods.';
COMMENT ON COLUMN public.financial_months.opening_included_cash IS 'Opening cash and equivalents included in the reported cash perimeter.';
COMMENT ON COLUMN public.financial_months.closing_included_cash IS 'Closing cash and equivalents included in the reported cash perimeter.';
COMMENT ON COLUMN public.financial_months.closing_unavailable_cash IS 'Included closing cash unavailable or reserved for ordinary obligations.';
COMMENT ON COLUMN public.financial_months.closing_taxes_reserved IS 'Closing taxes collected or withheld and reserved; included within closing_unavailable_cash, never added as a separate cash flow.';
COMMENT ON COLUMN public.financial_months.cash_reconciliation_difference IS 'Closing minus opening cash less classified cash movements; null until every bridge component is known.';

COMMIT;
