-- Onboarding completion flag.
-- null      = onboarding not completed (welcome banner may show)
-- timestamp = completed or dismissed (never show again)
--
-- Run in the Supabase SQL editor.

ALTER TABLE business_profiles
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz;

-- Existing users with imported data have effectively onboarded already.
UPDATE business_profiles bp
SET onboarding_completed_at = now()
WHERE onboarding_completed_at IS NULL
  AND EXISTS (
    SELECT 1 FROM financial_months fm WHERE fm.user_id = bp.user_id
  );

-- Refresh PostgREST's schema cache so the API sees the new column.
NOTIFY pgrst, 'reload schema';
