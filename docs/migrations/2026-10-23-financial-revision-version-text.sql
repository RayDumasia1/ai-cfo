-- Repair for projects that installed the initial financial-revision-history
-- migration with source_data_version defined as timestamptz.
-- Run ROLLBACK first if a verification transaction previously failed.
-- Apply in PREVIEW first. Safe after the corrected base migration as well.
BEGIN;

-- Preserve existing values and nulls. Do not parse the source profile token
-- as a date or change business_profiles.data_version or any financial rows.
ALTER TABLE public.financial_data_revisions
  ALTER COLUMN source_data_version TYPE text USING source_data_version::text;

COMMENT ON COLUMN public.financial_data_revisions.source_data_version IS
  'Exact opaque profile data_version token at capture time; nullable text, not a parsed date.';

COMMIT;
