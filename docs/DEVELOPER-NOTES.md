# Developer Notes — AlAqsa

> **PRIVATE.** These notes describe the tooling that stays with the developer
> (Areen) and is not handed to the shop.

---

## 1. Licence keys (kill switch)

The app only accepts licences signed with an Ed25519 private key that lives
**exclusively** in `tools/license-issuer/keys/private.pem`. That file, the
public key and the issued-licences log are all gitignored.

### First-time setup

```bash
cd tools/license-issuer
node issue-license.js keygen
```

This prints the public key. Embed it when building:

```bash
set ALAQSA_LICENSE_PUBKEY=<the base64 public key>
npm run package
```

> Without `ALAQSA_LICENSE_PUBKEY`, the build runs in permissive dev mode and
> accepts any licence. **Always set it for a real customer build.**

### Issuing licences

```bash
# Trial / staged payment — the app locks when this expires
node issue-license.js issue --client "Shop name" --days 30

# Paid in full — no expiry, never locks
node issue-license.js issue --client "Shop name" --perpetual

# With remote disable capability
node issue-license.js issue --client "Shop name" --days 60 \
     --heartbeat https://your-endpoint.example/alaqsa/check
```

Give the printed key to the customer; they enter it on the licence screen.

### Verifying

```bash
node issue-license.js verify <licence-string>
```

Tampering is detected: flipping `perpetual` to true in the payload makes the
signature report INVALID (this was tested).

### What expiry does

Expiry or revocation **locks** the app and shows the renewal screen with your
contact details. It **never deletes data** — the encrypted database stays
intact and becomes usable again the moment a valid key is entered.

This was a deliberate choice: remotely destroying a customer's records
(passports, IDs, contracts) would create legal exposure under UAE cyber-crime
law and risks wiping a paying customer's data through a bug. Locking gives the
same commercial leverage without that risk.

### Remote disable (optional)

Only works if the licence carries `--heartbeat`. The endpoint should answer:

```json
{ "revoked": false }
```

Returning `{"revoked": true}` locks the app on its next launch. If the server
is unreachable the app does **not** lock, so a connectivity outage can never
lock out a paying customer by accident.

---

## 2. Code signing

`scripts/setup-certificate.ps1` creates a self-signed code-signing certificate,
installs it into `LocalMachine\Root` and `LocalMachine\TrustedPublisher`, and
signs the build.

```powershell
# Run as Administrator, once per shop computer
.\scripts\setup-certificate.ps1

# After building, sign the output
.\scripts\setup-certificate.ps1 -SignPath .\release

# Back up the certificate so future builds keep the same identity
.\scripts\setup-certificate.ps1 -ExportPfx
```

**Scope:** a self-signed certificate is trusted only on machines where it has
been installed. That covers the shop's own computers, which is the agreed
deployment. Distributing to an unrelated third party would still warn them
unless they install the certificate — that would need a paid OV/EV certificate.

Keep the exported `.pfx` safe: signing future updates with the *same*
certificate avoids re-trusting on every machine.

---

## 3. Release checklist

```bash
npm run typecheck                       # both tsconfigs must be clean
npm run build
set ALAQSA_LICENSE_PUBKEY=<public key>  # never ship without this
npm run package                         # -> release/AlAqsa-Setup-1.0.0.exe
powershell -File scripts\setup-certificate.ps1 -SignPath .\release
```

Then hand over:

- `release/AlAqsa-Setup-1.0.0.exe`
- `scripts/setup-certificate.ps1` (only if installing on a new machine)
- `docs/دليل-التنصيب.md`, `docs/دليل-المستخدم.md`
- the licence key for that customer

Do **not** hand over: `tools/license-issuer/`, any `.pfx`/`.pem`, or these notes.

---

## 4. Data locations

```
%AppData%\Roaming\AlAqsa\
├── alaqsa.db      SQLCipher database (AES-256)
├── secure.json    wrapped DEK + recovery-key wrap (no plaintext secrets)
├── license.lic    signed licence blob
├── config.json    language / theme / network mode
├── files\         encrypted documents, photos, signatures
├── backups\       automatic + manual backups
└── reports\       generated PDFs and spreadsheets
```

The installer never touches this directory, which is what makes
uninstall-and-reinstall and install-over-update safe.

---

## 5. Key implementation details worth remembering

- **`@shared/*` alias**: `tsc` type-checks it but does not rewrite it in the
  emitted JS. `src/main/aliasRegister.ts` hooks `Module._resolveFilename` and
  must stay the first import in `main.ts`.
- **Electron readiness**: nothing may call `app.getPath()` at module import
  time. `SecureStore` loads its file lazily for this reason.
- **IPC shape**: every handler returns `Result<T>` (`{ok, data}` / `{ok, error}`).
  The renderer must unwrap it — a mismatch here silently blanks the whole UI.
- **Arabic in PDFs**: pdfmake has no bidi engine. `ar()` in `pdfService.ts`
  reverses word order and joins with U+00A0, because plain spaces get collapsed
  during layout. The bundled font has no dingbat glyphs, so ticks are Arabic
  words rather than ✔.
- **PowerShell scripts**: must be ASCII + BOM + CRLF. Windows PowerShell 5.1
  mis-parses BOM-less UTF-8 containing typographic characters such as an em
  dash, producing confusing "missing terminator" errors.
- **Native module**: `better-sqlite3-multiple-ciphers` is unpacked from the
  asar (`asarUnpack`) or it cannot be loaded at runtime.

---

## 6. Contact

Areen Abou Fakher — +971509471769 — arin.aboufakher@gmail.com — AreenHUB
