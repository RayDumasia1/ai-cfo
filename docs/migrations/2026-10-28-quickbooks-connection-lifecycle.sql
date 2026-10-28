-- INT-01B. Apply to preview first. Service-only lifecycle; no financial writes.
BEGIN;
CREATE TABLE public.quickbooks_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL UNIQUE REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  environment text NOT NULL DEFAULT 'sandbox' CHECK (environment='sandbox'),
  realm_id text CHECK (realm_id ~ '^[0-9]{1,30}$'),
  company_name text CHECK (length(company_name)<=200),
  generation uuid NOT NULL DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'disconnected' CHECK (status IN ('disconnected','authorizing','exchanging','verifying','connected','refreshing','reconnect_required','revoke_pending','revoking')),
  state_hash text CHECK (state_hash ~ '^[a-f0-9]{64}$'),
  browser_hash text CHECK (browser_hash ~ '^[a-f0-9]{64}$'),
  intent_actor uuid REFERENCES auth.users(id),
  intent_expires_at timestamptz,
  operation_id uuid, operation_started_at timestamptz,
  credential_revision integer NOT NULL DEFAULT 0,
  connected_at timestamptz, disconnected_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.quickbooks_credentials (
  connection_id uuid PRIMARY KEY REFERENCES public.quickbooks_connections(id) ON DELETE CASCADE,
  generation uuid NOT NULL,
  envelope jsonb NOT NULL CHECK (jsonb_typeof(envelope)='object' AND octet_length(envelope::text)<=65536 AND envelope->>'version'='1'),
  access_expires_at timestamptz NOT NULL, refresh_expires_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX quickbooks_one_company_binding ON public.quickbooks_connections(environment,realm_id)
  WHERE realm_id IS NOT NULL AND status<>'disconnected';
CREATE TABLE public.quickbooks_connection_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES auth.users(id),
  connection_id uuid NOT NULL REFERENCES public.quickbooks_connections(id) ON DELETE CASCADE,
  generation uuid NOT NULL, action text NOT NULL, status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.quickbooks_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quickbooks_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quickbooks_connection_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.quickbooks_connections,public.quickbooks_credentials FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.quickbooks_connection_audit FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.quickbooks_connections,public.quickbooks_credentials TO service_role;
GRANT SELECT,INSERT ON public.quickbooks_connection_audit TO service_role;
-- SECURITY INVOKER, service-only. Actor is derived from validated auth by the HTTP boundary.
-- Profile first, then connection lock: same workspace lock order as financial operations.
CREATE FUNCTION public.quickbooks_lifecycle(p_actor uuid,p_business uuid,p_action text,p_input jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c public.quickbooks_connections%ROWTYPE; s public.quickbooks_credentials%ROWTYPE;
  entitled boolean; result jsonb; include_secret boolean := false;
BEGIN
  IF p_actor IS NULL OR p_business IS NULL OR p_input IS NULL OR jsonb_typeof(p_input)<>'object' OR octet_length(p_input::text)>70000 THEN
    RAISE EXCEPTION 'Invalid connection request' USING ERRCODE='22023'; END IF;
  PERFORM 1 FROM public.business_profiles WHERE id=p_business AND user_id=p_actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Workspace not found' USING ERRCODE='42501'; END IF;
  SELECT EXISTS(SELECT 1 FROM public.subscriptions WHERE user_id=p_actor AND feature_tier IN ('core','growth','advisory')
    AND status IN ('active','pending_cancellation') AND (stripe_subscription_id IS NOT NULL OR plan<>'starter')) INTO entitled;
  IF p_action IN ('start','claim','verify','refresh_claim') AND NOT entitled THEN
    RAISE EXCEPTION 'Core subscription required' USING ERRCODE='42501'; END IF;
  SELECT * INTO c FROM public.quickbooks_connections WHERE business_id=p_business FOR UPDATE;
  IF NOT FOUND THEN
    IF p_action='read' THEN RETURN NULL; END IF;
    IF p_action<>'start' THEN RAISE EXCEPTION 'Connection not found' USING ERRCODE='P0002'; END IF;
    INSERT INTO public.quickbooks_connections(business_id) VALUES(p_business) RETURNING * INTO c;
  END IF;
  SELECT * INTO s FROM public.quickbooks_credentials WHERE connection_id=c.id;
  IF p_action='start' THEN
    IF c.status NOT IN ('disconnected','authorizing') THEN RAISE EXCEPTION 'Disconnect the existing connection first' USING ERRCODE='55000'; END IF;
    IF coalesce(p_input->>'stateHash','') !~ '^[a-f0-9]{64}$' OR coalesce(p_input->>'browserHash','') !~ '^[a-f0-9]{64}$' THEN
      RAISE EXCEPTION 'Invalid OAuth intent' USING ERRCODE='22023'; END IF;
    UPDATE public.quickbooks_connections SET status='authorizing',generation=gen_random_uuid(),realm_id=NULL,company_name=NULL,
      state_hash=p_input->>'stateHash',browser_hash=p_input->>'browserHash',intent_actor=p_actor,intent_expires_at=clock_timestamp()+interval '10 minutes',
      operation_id=NULL,operation_started_at=NULL,updated_at=clock_timestamp() WHERE id=c.id RETURNING * INTO c;
  ELSIF p_action IN ('claim','cancel_intent') THEN
    IF c.status<>'authorizing' OR c.intent_actor IS DISTINCT FROM p_actor OR c.intent_expires_at<=clock_timestamp()
      OR c.state_hash IS DISTINCT FROM p_input->>'stateHash' OR c.browser_hash IS DISTINCT FROM p_input->>'browserHash'
      OR (p_action='claim' AND coalesce(p_input->>'realmId','') !~ '^[0-9]{1,30}$') THEN
      RAISE EXCEPTION 'Invalid or expired OAuth intent' USING ERRCODE='55000'; END IF;
    IF p_action='cancel_intent' THEN
      UPDATE public.quickbooks_connections SET status='disconnected',generation=gen_random_uuid(),state_hash=NULL,browser_hash=NULL,
        intent_actor=NULL,intent_expires_at=NULL,updated_at=clock_timestamp() WHERE id=c.id RETURNING * INTO c;
    ELSE
    UPDATE public.quickbooks_connections SET status='exchanging',realm_id=p_input->>'realmId',operation_id=gen_random_uuid(),
      operation_started_at=clock_timestamp(),state_hash=NULL,browser_hash=NULL,updated_at=clock_timestamp() WHERE id=c.id RETURNING * INTO c;
    END IF;
  ELSIF p_action='read' THEN NULL;
  ELSIF p_action='disconnect_claim' THEN
    -- Never overlap a provider token mutation. A timed-out operation may only be disconnected, never retried.
    IF c.status IN ('exchanging','verifying','refreshing','revoking') AND c.operation_started_at>clock_timestamp()-interval '2 minutes' THEN
      RAISE EXCEPTION 'Connection operation in progress' USING ERRCODE='55000'; END IF;
    -- Retained credentials carry their original encryption generation separately.
    -- Rotate the live generation immediately, even when remote revocation fails.
    UPDATE public.quickbooks_connections SET status=CASE WHEN s.connection_id IS NULL THEN 'disconnected' ELSE 'revoking' END,
      generation=gen_random_uuid(),
      state_hash=NULL,browser_hash=NULL,intent_actor=NULL,intent_expires_at=NULL,operation_id=gen_random_uuid(),operation_started_at=clock_timestamp(),
      disconnected_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=c.id RETURNING * INTO c;
    include_secret := true;
  ELSIF p_action='refresh_claim' THEN
    IF c.status<>'connected' OR s.connection_id IS NULL OR s.refresh_expires_at<=clock_timestamp() THEN
      RAISE EXCEPTION 'Reconnect or finish the current operation first' USING ERRCODE='55000'; END IF;
    UPDATE public.quickbooks_connections SET status='refreshing',operation_id=gen_random_uuid(),operation_started_at=clock_timestamp(),updated_at=clock_timestamp()
      WHERE id=c.id RETURNING * INTO c;
    include_secret := true;
  ELSE
    IF c.generation IS DISTINCT FROM (p_input->>'generation')::uuid OR c.operation_id IS DISTINCT FROM (p_input->>'operationId')::uuid
      OR c.operation_id IS NULL THEN RAISE EXCEPTION 'Connection operation changed' USING ERRCODE='40001'; END IF;
    IF p_action IN ('store_grant','refresh_finish') THEN
      IF (p_action='store_grant' AND c.status<>'exchanging') OR (p_action='refresh_finish' AND c.status<>'refreshing') THEN
        RAISE EXCEPTION 'Connection operation changed' USING ERRCODE='40001'; END IF;
      IF jsonb_typeof(p_input->'envelope') IS DISTINCT FROM 'object' OR p_input->'envelope'->>'version' IS DISTINCT FROM '1'
        OR (p_input->>'accessExpiresAt')::timestamptz IS NULL OR (p_input->>'refreshExpiresAt')::timestamptz IS NULL THEN
        RAISE EXCEPTION 'Invalid credential envelope' USING ERRCODE='22023'; END IF;
      INSERT INTO public.quickbooks_credentials(connection_id,generation,envelope,access_expires_at,refresh_expires_at)
        VALUES(c.id,c.generation,p_input->'envelope',(p_input->>'accessExpiresAt')::timestamptz,(p_input->>'refreshExpiresAt')::timestamptz)
        ON CONFLICT(connection_id) DO UPDATE SET generation=excluded.generation,envelope=excluded.envelope,access_expires_at=excluded.access_expires_at,refresh_expires_at=excluded.refresh_expires_at;
      UPDATE public.quickbooks_connections SET credential_revision=credential_revision+1,
        status=CASE WHEN p_action='store_grant' THEN 'verifying' WHEN entitled THEN 'connected' ELSE 'reconnect_required' END,
        operation_id=CASE WHEN p_action='refresh_finish' THEN NULL ELSE operation_id END,
        operation_started_at=CASE WHEN p_action='refresh_finish' THEN NULL ELSE operation_started_at END,
        updated_at=clock_timestamp() WHERE id=c.id RETURNING * INTO c;
    ELSIF p_action='verify' THEN
      IF c.status<>'verifying' OR s.connection_id IS NULL OR length(coalesce(p_input->>'companyName','')) NOT BETWEEN 1 AND 200 THEN
        RAISE EXCEPTION 'Company verification required' USING ERRCODE='55000'; END IF;
      UPDATE public.quickbooks_connections SET status='connected',company_name=p_input->>'companyName',connected_at=clock_timestamp(),
        operation_id=NULL,operation_started_at=NULL,updated_at=clock_timestamp() WHERE id=c.id RETURNING * INTO c;
    ELSIF p_action='fail' THEN
      IF c.status NOT IN ('exchanging','verifying','refreshing') THEN RAISE EXCEPTION 'Connection operation changed' USING ERRCODE='40001'; END IF;
      UPDATE public.quickbooks_connections SET status='reconnect_required',operation_id=NULL,operation_started_at=NULL,updated_at=clock_timestamp() WHERE id=c.id RETURNING * INTO c;
    ELSIF p_action IN ('disconnect_finish','disconnect_fail') THEN
      IF c.status<>'revoking' THEN RAISE EXCEPTION 'Connection operation changed' USING ERRCODE='40001'; END IF;
      IF p_action='disconnect_finish' THEN DELETE FROM public.quickbooks_credentials WHERE connection_id=c.id; END IF;
      UPDATE public.quickbooks_connections SET status=CASE WHEN p_action='disconnect_finish' THEN 'disconnected' ELSE 'revoke_pending' END,
        generation=CASE WHEN p_action='disconnect_finish' THEN gen_random_uuid() ELSE generation END,
        operation_id=NULL,operation_started_at=NULL,updated_at=clock_timestamp() WHERE id=c.id RETURNING * INTO c;
    ELSE RAISE EXCEPTION 'Unknown connection action' USING ERRCODE='22023'; END IF;
  END IF;
  IF p_action<>'read' THEN INSERT INTO public.quickbooks_connection_audit(business_id,actor_id,connection_id,generation,action,status)
    VALUES(p_business,p_actor,c.id,c.generation,p_action,c.status); END IF;
  result := jsonb_build_object('id',c.id,'businessId',c.business_id,'generation',c.generation,'environment',c.environment,
    'realmId',c.realm_id,'companyName',c.company_name,'status',c.status,'operationId',c.operation_id,'credentialRevision',c.credential_revision,
    'connectedAt',c.connected_at,'disconnectedAt',c.disconnected_at);
  IF include_secret THEN result:=result||jsonb_build_object('envelope',s.envelope,'credentialGeneration',s.generation,'accessExpiresAt',s.access_expires_at,'refreshExpiresAt',s.refresh_expires_at); END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.quickbooks_lifecycle(uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.quickbooks_lifecycle(uuid,uuid,text,jsonb) TO service_role;
COMMIT;
