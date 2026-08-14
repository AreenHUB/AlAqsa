// ============================================================================
// AlAqsa — Guard: refuse to package a customer build without a licence key.
//
// A build with no ALAQSA_LICENSE_PUBKEY grants a perpetual licence to whoever
// runs it. That is intentional while developing, and a serious commercial
// mistake if it is handed to a customer, so the packaging step stops unless
// the key is set — or a dev build is explicitly requested.
// ============================================================================

const key = process.env.ALAQSA_LICENSE_PUBKEY;
const allowDev = process.env.ALAQSA_ALLOW_DEV_BUILD === '1';

if (!key) {
  if (allowDev) {
    console.warn('\n  [!] Building WITHOUT a licence key (ALAQSA_ALLOW_DEV_BUILD=1).');
    console.warn('      This build grants a perpetual licence to anyone. Do not ship it.\n');
    process.exit(0);
  }
  console.error(`
  ============================================================
   Refusing to package: no licence public key.

   Without ALAQSA_LICENSE_PUBKEY the app grants a PERPETUAL
   licence to anyone who installs it.

   For a customer build:
     set ALAQSA_LICENSE_PUBKEY=<public key from keys/public.b64>
     npm run package

   For a deliberate development build:
     set ALAQSA_ALLOW_DEV_BUILD=1
     npm run package
  ============================================================
`);
  process.exit(1);
}

if (key.length < 40) {
  console.error(`\n  Refusing to package: ALAQSA_LICENSE_PUBKEY looks malformed (${key.length} chars).\n`);
  process.exit(1);
}

console.log('  licence key present — building a customer release');
