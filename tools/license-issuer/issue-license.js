#!/usr/bin/env node
/* ============================================================================
 * AlAqsa — License issuer (DEVELOPER-ONLY TOOL)
 * ----------------------------------------------------------------------------
 * Generates the Ed25519 key pair and mints signed licence keys for the app.
 *
 *   The PRIVATE key stays here and must NEVER be shipped or committed.
 *   The PUBLIC key is embedded into the app at build time; only licences
 *   signed with the matching private key are accepted.
 *
 * A licence can be time-limited (locks the app when it expires) or perpetual
 * (issued once the customer has paid in full). Expiry LOCKS the app — it never
 * deletes data; the encrypted database stays intact until a new key is entered.
 *
 * USAGE
 *   node issue-license.js keygen
 *       Creates keys/private.pem + keys/public.b64 (run once, then keep safe).
 *
 *   node issue-license.js issue --client "AlAqsa Shop" --days 30
 *   node issue-license.js issue --client "AlAqsa Shop" --perpetual
 *   node issue-license.js issue --client "X" --days 60 --heartbeat https://...
 *
 *   node issue-license.js verify <licence-string>
 *
 * Author: Areen Abou Fakher <arin.aboufakher@gmail.com> +971509471769
 * ========================================================================== */

'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const KEYS_DIR = path.join(__dirname, 'keys');
const PRIVATE_PEM = path.join(KEYS_DIR, 'private.pem');
const PUBLIC_B64 = path.join(KEYS_DIR, 'public.b64');
const ISSUED_LOG = path.join(__dirname, 'issued-licenses.json');

// --- helpers ---------------------------------------------------------------

function canonical(payload) {
  // Must match the app's verification order exactly.
  return JSON.stringify(payload, Object.keys(payload).sort());
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) out[key] = true;
      else { out[key] = next; i++; }
    }
  }
  return out;
}

function ensureKeys() {
  if (!fs.existsSync(PRIVATE_PEM)) {
    console.error('\n  No signing key found.\n  Run:  node issue-license.js keygen\n');
    process.exit(1);
  }
}

// --- commands --------------------------------------------------------------

function keygen() {
  if (fs.existsSync(PRIVATE_PEM)) {
    console.error('\n  A private key already exists at:\n   ', PRIVATE_PEM);
    console.error('  Refusing to overwrite it — every licence already issued would stop working.');
    console.error('  Delete it manually only if you are certain.\n');
    process.exit(1);
  }

  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  fs.mkdirSync(KEYS_DIR, { recursive: true });

  fs.writeFileSync(
    PRIVATE_PEM,
    privateKey.export({ type: 'pkcs8', format: 'pem' }),
    { mode: 0o600 },
  );
  const pubB64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  fs.writeFileSync(PUBLIC_B64, pubB64);

  console.log('\n  Key pair created.\n');
  console.log('  Private key :', PRIVATE_PEM, '  <-- KEEP SECRET, never commit or share');
  console.log('  Public key  :', PUBLIC_B64);
  console.log('\n  Embed this public key when building the app:\n');
  console.log('    set ALAQSA_LICENSE_PUBKEY=' + pubB64);
  console.log('    npm run package\n');
}

function issue(args) {
  ensureKeys();

  const clientName = typeof args.client === 'string' ? args.client : '';
  if (!clientName) {
    console.error('\n  --client "Name" is required.\n');
    process.exit(1);
  }

  const perpetual = !!args.perpetual;
  const days = args.days ? Number(args.days) : null;

  if (!perpetual && (!days || !Number.isFinite(days) || days <= 0)) {
    console.error('\n  Provide either --days <n> or --perpetual.\n');
    process.exit(1);
  }

  const now = new Date();
  const payload = {
    v: 1,
    clientName,
    issuedAt: now.toISOString(),
    perpetual,
  };
  if (!perpetual) {
    payload.expiresAt = new Date(now.getTime() + days * 86400000).toISOString();
  }
  if (typeof args.heartbeat === 'string') payload.heartbeatUrl = args.heartbeat;
  if (typeof args.note === 'string') payload.note = args.note;
  if (typeof args.machine === 'string') payload.machineId = args.machine;

  const privateKey = crypto.createPrivateKey(fs.readFileSync(PRIVATE_PEM));
  const sig = crypto.sign(null, Buffer.from(canonical(payload)), privateKey);

  const licence = Buffer.from(
    JSON.stringify({ payload, sig: sig.toString('base64') }),
  ).toString('base64');

  // Keep a local record of what was issued to whom.
  let log = [];
  try { log = JSON.parse(fs.readFileSync(ISSUED_LOG, 'utf8')); } catch { /* first run */ }
  log.push({ ...payload, issuedOn: now.toISOString(), licencePrefix: licence.slice(0, 24) });
  fs.writeFileSync(ISSUED_LOG, JSON.stringify(log, null, 2));

  console.log('\n  ============================================================');
  console.log('   Licence issued');
  console.log('  ============================================================');
  console.log('   Client   :', clientName);
  console.log('   Type     :', perpetual ? 'PERPETUAL (no expiry)' : `${days} day(s)`);
  if (payload.expiresAt) {
    console.log('   Expires  :', payload.expiresAt.slice(0, 10));
  }
  if (payload.heartbeatUrl) {
    console.log('   Heartbeat:', payload.heartbeatUrl);
  }
  console.log('\n   Give this key to the customer:\n');
  console.log(licence);
  console.log('\n   They enter it in the app on the licence screen.');
  console.log('  ============================================================\n');
}

function verify(argv) {
  const str = argv[0];
  if (!str) {
    console.error('\n  Usage: node issue-license.js verify <licence-string>\n');
    process.exit(1);
  }
  if (!fs.existsSync(PUBLIC_B64)) {
    console.error('\n  No public key found — run keygen first.\n');
    process.exit(1);
  }

  try {
    const signed = JSON.parse(Buffer.from(str.trim(), 'base64').toString('utf8'));
    const pub = crypto.createPublicKey({
      key: Buffer.from(fs.readFileSync(PUBLIC_B64, 'utf8'), 'base64'),
      format: 'der',
      type: 'spki',
    });
    const ok = crypto.verify(
      null,
      Buffer.from(canonical(signed.payload)),
      pub,
      Buffer.from(signed.sig, 'base64'),
    );

    console.log('\n  Signature :', ok ? 'VALID' : 'INVALID');
    console.log('  Client    :', signed.payload.clientName);
    console.log('  Perpetual :', signed.payload.perpetual);
    if (signed.payload.expiresAt) {
      const left = Math.ceil(
        (new Date(signed.payload.expiresAt) - new Date()) / 86400000,
      );
      console.log('  Expires   :', signed.payload.expiresAt.slice(0, 10),
        left >= 0 ? `(${left} day(s) left)` : '(EXPIRED)');
    }
    console.log('');
  } catch (e) {
    console.error('\n  Could not read that licence:', e.message, '\n');
    process.exit(1);
  }
}

function usage() {
  console.log(`
  AlAqsa licence issuer — developer tool

    node issue-license.js keygen
    node issue-license.js issue --client "Shop name" --days 30
    node issue-license.js issue --client "Shop name" --perpetual
    node issue-license.js verify <licence-string>

  Options for "issue":
    --client   <name>   required, who the licence is for
    --days     <n>      time-limited licence
    --perpetual         no expiry (use after full payment)
    --heartbeat <url>   optional remote disable endpoint
    --note     <text>   free-text note stored in the licence
`);
}

// --- entry point -----------------------------------------------------------

const [, , cmd, ...rest] = process.argv;
const args = parseArgs(rest);

switch (cmd) {
  case 'keygen': keygen(); break;
  case 'issue': issue(args); break;
  case 'verify': verify(rest); break;
  default: usage(); break;
}
