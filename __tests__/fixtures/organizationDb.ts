import { readFileSync } from "node:fs";
export const orgOwner = "10000000-0000-4000-8000-000000000001";
export const orgOther = "10000000-0000-4000-8000-000000000002";
export const orgProfile = "20000000-0000-4000-8000-000000000001";
export const orgOtherProfile = "20000000-0000-4000-8000-000000000002";
export const orgMigration = () => readFileSync(new URL("../../docs/migrations/2026-10-28-organization-shadow-storage.sql", import.meta.url), "utf8");
export const orgBootstrap = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS 'SELECT nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
CREATE TABLE public.business_profiles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  business_name text, data_version text, min_cash_reserve numeric, onboarding_completed_at timestamptz,
  created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
CREATE FUNCTION public.update_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=now(); RETURN NEW; END $$;
CREATE TRIGGER trg_business_profiles_updated_at BEFORE UPDATE ON public.business_profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
ALTER TABLE public.business_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "business_profiles: own rows" ON public.business_profiles TO authenticated USING(auth.uid()=user_id) WITH CHECK(auth.uid()=user_id);
GRANT SELECT,INSERT,UPDATE ON public.business_profiles TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.business_profiles TO service_role;
CREATE TABLE public.cfo_calls(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid REFERENCES auth.users(id));
INSERT INTO auth.users VALUES('${orgOwner}'),('${orgOther}');
INSERT INTO public.business_profiles(id,user_id,business_name,data_version,min_cash_reserve) VALUES
('${orgProfile}','${orgOwner}','Existing business','keep-version',0),('${orgOtherProfile}','${orgOther}',NULL,NULL,NULL);
`;
