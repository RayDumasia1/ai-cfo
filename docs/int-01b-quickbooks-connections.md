# INT-01B — QuickBooks sandbox connection lifecycle

28 October 2026. Implemented with local and Supabase preview database validation complete. Live sandbox acceptance requires an Intuit developer app and sandbox company; the owner does not yet have these set up.

## Outcome and boundaries

Settings → Connections exposes sandbox authorization, connection metadata, an explicit token refresh check and disconnect. Connected means an authorized company, **not** imported financial data. The existing financial-sync endpoint still returns 501. This increment writes no financial months, actual cash events, forecasts, usage or Stripe billing records.

Only sandbox authorization is enabled in this increment, even on a hosted production build. Production QuickBooks credentials are rejected. The Intuit Accounting scope is the provider's broad accounting permission; this application currently makes only authorization/token/revocation requests and a company-information GET. It does not advertise a provider-enforced read-only scope.

## Trust and storage

The validated, email-verified Supabase session supplies the actor. The account-owned profile lookup supplies the business ID. No endpoint accepts an owner, workspace, realm override or return URL from a request body. The SQL RPC locks the profile before its connection, checks current ownership, and checks paid Core/Growth/Advisory entitlement for authorization and refresh. A completion after entitlement loss retains rotated credentials for revocation without restoring connected access. Business IDs and actor IDs are separate; organization memberships remain future ORG-01 work.

`quickbooks_connections`, `quickbooks_credentials` and `quickbooks_connection_audit` have RLS and no browser grants or policies. The SECURITY INVOKER lifecycle RPC is service-only. Its actor arguments are trusted only after the HTTP authentication boundary; granting execution to authenticated users would be unsafe. The service client never goes to the browser. Read responses explicitly project four safe metadata fields; encrypted credentials, operations, realms and generations are omitted. Audit entries retain actor/business/action/generation/status, without codes, state, tokens, query strings or provider error bodies.

A connection binds one sandbox company per business. An active company cannot be simultaneously bound to another business in this deployment. Company changes require disconnect first. CompanyInfo is requested at the fixed realm-scoped sandbox endpoint with the newly issued token. Its entity `Id` is not the OAuth realm ID; successful access to that realm-scoped endpoint confirms the binding. Home currency remains unknown until retrieval config establishes it.

OAuth state and an independent browser nonce each use 32 random bytes. Only their SHA-256 hashes are stored. The ten-minute intent is actor/business/browser-bound; newer starts replace earlier unconsumed intents. Callback consumes it atomically **before** exchanging a code. Duplicate/expired/foreign callbacks never exchange codes. The nonce cookie is HttpOnly, SameSite=Lax and Secure on HTTPS; callback deletes it and redirects to a fixed settings destination with no-store/no-referrer headers. POST mutations require the configured origin; arbitrary Host/return URLs are not trusted. Cancellation consumes the same bound intent. Provider failure details are never reflected or logged.

AES-256-GCM uses a fresh 12-byte IV and authenticated context containing key ID, business, connection, generation, realm and environment. The keyring supports opening retained keys and resealing under the active key during token refresh. Remove an old key only after all retained envelopes (including revocation recovery) have moved to the active key or been deleted. Do not regenerate encryption keys on every deployment; store them securely in the deployment environment and retain a protected recovery copy.

Refresh claims a single persisted operation. Another refresh cannot take over an expired operation or reuse an uncertain token response. Latest access/refresh tokens and provider expiry durations are stored together with operation/generation fencing; provider absolute refresh expiry is requested and retained when supplied. No constant promise of indefinitely renewable access is made. HTTP calls time out after 15 seconds, have bounded bodies, refuse redirects and do not automatically retry token mutations. A failure requires disconnect/reconnect rather than replaying an authorization code or guessing which rotated token won.

Disconnect is available after downgrade/cancellation, including through the exact proxy exception and Connections settings tab. It fences local access and rotates the live generation before provider revocation, preserving financial records. The encrypted credential carries its original encryption generation separately. Failed revocation retains only the credential needed for retry, reports revocation pending and blocks a newer authorization. Successful revocation deletes the credential. A refresh/revoke currently in flight returns a conflict; after two minutes the owner can disconnect an abandoned operation. Late completions cannot reconnect the workspace. Clear Data integration and publication generation checks remain INT-01D: no sync job or publication path exists here.

As with any remote OAuth exchange, a process crash or persistent database failure between receiving a grant and storing it can leave an unrecorded provider grant. A company lookup failure after successful storage retains the encrypted grant and requires disconnect. An unknown/unrecorded grant must be removed from the sandbox company's connected apps if needed before retrying. This increment does not claim cross-system atomicity or automated recovery from lost credentials. Lost encryption keys require provider-side removal; do not delete recovery records merely to bypass failed revocation.

## Local setup

1. Sign in at [Intuit Developer](https://developer.intuit.com/) and create a QuickBooks Online app with Accounting scope. Open Development keys/credentials and the sandbox-company area. Use a test company and development credentials, not a paid/live company. [Intuit sandbox FAQ](https://static.developer.intuit.com/output_html/qbo/docs/develop/sandboxes/sandbox-faqs.html)
2. Register `http://localhost:3000/api/integrations/quickbooks/callback` exactly as a development redirect URI.
3. Save `QUICKBOOKS_CLIENT_ID` and `QUICKBOOKS_CLIENT_SECRET` in Git-ignored `.env.local`; never send them in chat.
4. `node scripts/configure-quickbooks-local.mjs` adds missing encryption settings and these defaults without printing keys or replacing existing values:
   - `QUICKBOOKS_ENVIRONMENT=sandbox`
   - `QUICKBOOKS_REDIRECT_URI=http://localhost:3000/api/integrations/quickbooks/callback`
   - `QUICKBOOKS_TOKEN_KEYS` is a JSON object mapping key IDs to base64-encoded 32-byte keys.
   - `QUICKBOOKS_ACTIVE_TOKEN_KEY_ID` selects a key from that object.
5. Restart `npm run dev`. Sign in to the paid Core-or-above preview test account and open `/dashboard/settings?tab=connections`.

For hosted preview, register a stable HTTPS callback ending in the same path and set the six server variables in the **Preview** deployment environment. A local `.env.local` change does not configure Vercel. The configured callback origin must be the origin used to open the app, including during POSTs. Use a stable branch alias and its matching preview Supabase project. Do not copy secrets into public `NEXT_PUBLIC_*` variables. Keep local and hosted keyrings consistent if they use the same preview database, or retain all applicable keys in both environments.

## Migration and acceptance

Validation: 1,345 tests passed across 82 local test files; four remote-only probes remain skipped by the default suite. TypeScript, targeted ESLint and the production build passed. The initial default-parallel suite hit existing five-second cash-planning UI timeouts; the complete final suite passed with `npm test -- --maxWorkers=2` without altering their timeout budgets or implementation. The new SQL migration was applied to the confirmed Supabase preview project. Its rollback-only verifier passed browser/workspace/state binding, replay rejection, refresh serialization, downgrade disconnect, generation fencing, encrypted revocation recovery, client privilege checks and unchanged financial rows/data version. Two independent PostgreSQL sessions confirmed workspace/lifecycle contention. All verifier fixtures rolled back; no production database operation was performed.

Apply `docs/migrations/2026-10-28-quickbooks-connection-lifecycle.sql` to preview before deploying code that reads its tables. Run `node scripts/validate-quickbooks-preview.mjs --apply` using the existing preview-only connection/project-ref/two-account configuration. It applies only the missing new migration, runs the rollback-only verifier, and checks real two-session lock contention. Never run `verify-quickbooks-connection-lifecycle.sql` in production. Production migration/promotion remains separate from this increment's preview work.

Live sandbox checks still required:

- Authorize from Settings, choose the sandbox company, return to the same signed-in account and see its name plus the data-not-ready explanation.
- Cancel consent and confirm no connection; start again and verify stale/replayed callbacks do not reconnect or re-exchange a code.
- Check connection to rotate credentials, then reload and confirm connected metadata persists without exposing tokens in JSON or browser storage.
- Disconnect, reload, confirm disconnected, and confirm saved financial records/plans remain unchanged. Reconnect to the sandbox only after revocation finishes.
- Provider failure/timeout should show a recoverable attention/revocation state; a second account must not see or operate the first business's connection.

Provider endpoint, authorization scope, refresh-token rotation and absolute-expiry header behavior were checked against [Intuit's OAuth client source](https://github.com/intuit/oauth-jsclient/blob/master/src/OAuthClient.js) and [token handling guide](https://github.com/intuit/oauth-jsclient#refresh-access_token). CompanyInfo is realm-scoped per [Intuit's API example](https://intuitdeveloper.github.io/hack/), while its `Id` is an entity identifier per [Intuit's CompanyInfo SDK reference](https://static.developer.intuit.com/sdkdocs/qbv3doc/ippdotnetdevkitv3/html/75d7858e-4449-a7c0-c8a7-32d6ca525b16.htm).
