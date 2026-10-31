# Voult security notes and threat model

This is the self-review that goes with v1.0. It is **not** an external audit: the plan's acceptance
criterion ("external review of crypto, autofill and passkey code") still needs a person outside the
project. Section 6 lists what to hand a reviewer.

## 1. What we protect and from whom

| Asset                                                                                | Attacker we design against                                          |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Vault contents (passwords, TOTP secrets, passkey private keys, notes, cards)         | Server/DB/backup compromise (VM theft, Drive account takeover)      |
| Master password                                                                      | Anyone who can read the server, Drive, network traffic or the DB    |
| Unlocked vault in memory                                                             | Malicious web pages (autofill), other apps on the phone             |
| Passkey private keys                                                                 | Phishing sites, rogue native apps, a stolen backup file             |
| Availability of data                                                                 | Losing the server (restorable from a Drive/.voult file + password)  |

Out of scope (cannot be defended by software of this kind): a compromised OS or browser, malware with
root / debugger access to the running app, a user typing the master password into a phishing page,
hardware attacks on an unlocked, rooted device.

## 2. Cryptographic design (see `packages/core/src/crypto`)

- **Master password -> keys:** Argon2id (browser: WASM; Android: native) -> HKDF into a login key
  (sent to the server as proof, then hashed again with Argon2id server-side) and a key-encryption key
  that never leaves the device. The server never sees the master password or the KEK.
- **Key hierarchy:** random account key (wrapped by the KEK and by a recovery key) -> per-vault keys ->
  per-item keys. Items are XChaCha20-Poly1305 with the item id and version bound as associated data,
  so ciphertexts cannot be swapped between items or replayed at an older version.
- **Sync server:** stores ciphertext and metadata only (ids, types, timestamps). Test
  `keeps no plaintext in the database file` greps the SQLite file for secrets.
- **Backups/exports:** a `voult-snapshot` is the same encrypted records plus KDF parameters and the
  wrapped keys: opening one needs the master password (or recovery secret) and nothing else.
- **Google Drive:** only the `drive.file` scope (Voult sees files it created). The OAuth refresh token
  is encrypted with AES-256-GCM under a key derived from `JWT_SECRET`; a DB leak alone reveals nothing,
  a full server compromise does reveal the token, which lets an attacker upload/delete files in the
  "Voult Backups" folder but not read your vault.
- **Quick unlock:** Android biometrics use a Keystore key that needs a fresh strong biometric per use;
  the Android PIN is wrapped by Argon2id(PIN) and again by a hardware-backed key (5 tries). The
  extension PIN (6 digits) is stored in `storage.local` wrapped by Argon2id (64 MiB, 3 passes) so it
  survives restarts; **a copy of that file permits an offline 10^6 guess** and the UI says the master
  password is stronger.

## 3. Threats and mitigations

| Threat                                                                    | Mitigation                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Malicious page reads or triggers autofill                                 | Content script uses a closed shadow root; fills only on trusted (`isTrusted`) user gestures; credentials are only sent after the user picks an entry; matching uses the registrable domain (PSL) or exact host; never fills cross-origin iframes unless their own origin matches; http is refused except localhost. |
| Page sees the master password / PIN                                       | Unlock UI is an extension iframe (page cannot read its key events); nothing typed there is passed through page-owned elements.                                                                                                          |
| Phishing with passkeys                                                    | rpId must equal or be a registrable suffix of the page host; native Android callers must be linked to the site through Digital Asset Links; browsers are accepted only from the privileged-browser allowlist with a signing-certificate check. |
| Rogue Android app reads autofill suggestions                              | Suggestions only list label/username for logins matching the requesting app/site; passwords are decrypted only after the user picks a login and unlocks. The index is encrypted with a Keystore key and holds no secrets.             |
| Screenshots / recents / clipboard                                         | `FLAG_SECURE` (setting, default on) on every Voult window including the autofill drawer; copies flagged sensitive and auto-cleared.                                                                                                    |
| Stolen/rooted phone files                                                 | `allowBackup=false`; refresh token in Keystore-backed secure store; the vault SQLite is ciphertext.                                                                                                                                     |
| Token theft                                                               | Rotating refresh tokens with reuse detection (replay revokes the device); short-lived access tokens; per-device revocation.                                                                                                             |
| Brute force against the server                                            | Rate limits on login/signup/prelogin; auth key hashed again with Argon2id; unknown emails get a stable fake salt.                                                                                                                       |
| Password breach lookup leaking passwords                                  | HIBP k-anonymity: only the first 5 characters of the SHA-1 go out, padded responses, and only when the user taps the button and confirms.                                                                                               |
| Malicious update                                                          | Android: update check only on user tap, link must be an `https://github.com/` URL, installation is manual. Firefox: AMO-signed `.xpi` with a hash in `updates.json`. Chrome: store-managed.                                              |
| Supply chain                                                              | Dependencies pinned in the lockfile, `pnpm audit --prod --audit-level high` in CI and release, strict extension CSP (no remote code, no analytics).                                                                                    |

## 4. Known limitations

1. The password-strength estimator is a small built-in heuristic (not zxcvbn-ts) to avoid shipping
   large dictionaries; it flags the common cases and is deliberately conservative.
2. Autofill matching of **apps** relies on links the user creates (`androidapp://package`), not
   automatic Digital Asset Links resolution.
3. A server compromise can DoS you or tamper with ciphertext (AEAD makes tampering detectable, not
   impossible); it cannot read the vault. Metadata (item count, types, timestamps) is visible to it.
4. The Chrome extension service worker can be suspended: keys live in `storage.session` (memory),
   so a browser restart locks the vault by design (the PIN is the convenience path).
5. Moderate/low advisories remain only in Expo build tooling (`glob`, `minimatch`, `deepmerge`) that is
   not part of any shipped artefact; the high zod advisory is fixed through a workspace override.
6. Translations cover navigation, settings, the new health/import/backup panels and the sign-in
   screens; a few older strings remain English-only (see CHANGELOG).
7. Reproducible builds are not set up: verify an APK/extension by its signing certificate, not by hash.

## 5. Accessibility (WCAG 2.1 AA)

- Colour tokens are checked in CI (`packages/ui-tokens/src/contrast.test.ts`): every text/background pair
  used by the apps reaches 4.5:1 in light and dark.
- Extension: full keyboard use (tab order, custom `Select` / `Checkbox` / `Switch` expose combobox,
  checkbox and switch roles with arrow-key / Space / Enter / Escape handling); dialogs and status
  changes use `role="status"` / `role="alert"`.
- Android: controls carry `accessibilityRole` and labels (toggles, checkboxes, sheets, the OTP PIN, the
  autofill drawer rows); touch targets are at least 40 dp. TalkBack on a real device is still to be
  walked through by a person.

## 6. For an external reviewer

Start here, in this order:

1. `packages/core/src/crypto/*` and `vault/ops.ts` (key hierarchy, AAD binding).
2. `packages/core/src/webauthn/*` and `apps/extension/lib/bg/passkeys.ts`,
   `apps/mobile/src/autofill/flows.ts`, `modules/voult-native/.../CredentialActivity.kt` (origin and rpId
   checks, privileged-browser allowlist, Digital Asset Links).
3. `apps/extension/entrypoints/content/*` and `lib/autofill/*` (page isolation, gesture checks).
4. `modules/voult-native/.../VoultAutofillService.kt`, `FieldParser.kt`, `DeviceVault.kt`.
5. `apps/server/src/auth/*`, `routes/*`, `backup/*` (token handling, rate limits, OAuth state).

Run the full suite with `pnpm lint && pnpm typecheck && pnpm test` and `pnpm --filter @voult/extension e2e`.
