// Generate missing local-only encryption configuration. Never prints key material.
import { readFileSync, appendFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
const file = new URL('../.env.local', import.meta.url);
const existing = readFileSync(file, 'utf8');
const has = name => new RegExp(`^\\s*${name}\\s*=`, 'm').test(existing);
if (has('QUICKBOOKS_TOKEN_KEYS') !== has('QUICKBOOKS_ACTIVE_TOKEN_KEY_ID')) {
  throw new Error('Partial encryption configuration exists. Preserve the existing keys and repair the key ID before continuing.');
}
const entries = [];
if (!has('QUICKBOOKS_TOKEN_KEYS')) {
  entries.push(`QUICKBOOKS_TOKEN_KEYS='${JSON.stringify({ local_v1: randomBytes(32).toString('base64') })}'`, 'QUICKBOOKS_ACTIVE_TOKEN_KEY_ID=local_v1');
}
if (!has('QUICKBOOKS_ENVIRONMENT')) entries.push('QUICKBOOKS_ENVIRONMENT=sandbox');
if (!has('QUICKBOOKS_REDIRECT_URI')) entries.push('QUICKBOOKS_REDIRECT_URI=http://localhost:3000/api/integrations/quickbooks/callback');
if (entries.length) appendFileSync(file, `\n# INT-01B local sandbox setup\n${entries.join('\n')}\n`);
console.log(entries.length ? 'Added missing sandbox/encryption settings to .env.local. Existing values were preserved.' : 'Sandbox/encryption settings already exist; no changes.');
