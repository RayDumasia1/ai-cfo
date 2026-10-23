-- Apply before deploying the checkout changes. No production changes are made
-- by adding this file. One durable attempt per account coordinates app instances.
CREATE TABLE IF NOT EXISTS public.subscription_checkout_attempts (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  id uuid NOT NULL UNIQUE,
  plan_key text NOT NULL,
  price_id text NOT NULL,
  app_url text NOT NULL,
  customer_id text,
  session_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.subscription_checkout_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.subscription_checkout_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.subscription_checkout_attempts TO service_role;

NOTIFY pgrst, 'reload schema';
