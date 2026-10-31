# Architecture

A short tour of how Voult fits together. The threat model and cryptographic details are in
[SECURITY.md](SECURITY.md); this page is about the moving parts.

```
 Browser extension (WXT, MV3)           Android app (Expo + Kotlin)
 popup · autofill · passkeys            screens · AutofillService · Credential Manager
        │                                      │
        └────────────── @voult/core ───────────┘
          crypto · vault · TOTP · generator · sync client · importers · i18n
                              │  ciphertext only (HTTPS)
                              ▼
                    Voult server (Hono + SQLite)
                              │
                              └── optional: encrypted snapshots to your Google Drive
```

## Packages

| Path                 | Role                                                                                                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core`      | Everything that must behave identically on every client: Argon2id/HKDF/XChaCha20-Poly1305, key hierarchy, item schemas, TOTP, password/passphrase generator, sync with `rev`/`If-Match` and an outbox, WebAuthn authenticator, importers, backup snapshots, translations. Heavily unit-tested; changes are test-first. |
| `apps/server`        | Hono API with SQLite (Drizzle). Accounts, devices with rotating refresh tokens, the encrypted record store, rate limiting, and the optional Google Drive backup job. It never holds a key that can open a vault. |
| `apps/extension`     | WXT (Manifest V3) extension for Chrome and Firefox: popup UI (React + Tailwind), background worker holding the unlocked session, content script for autofill and the save/update prompts, passkey interception for `navigator.credentials`. |
| `apps/mobile`        | Expo (React Native) Android app plus the `voult-native` Kotlin module: Android Autofill service, Credential Manager provider for passkeys, Keystore-backed quick unlock. The autofill drawer reuses the app's React code. |
| `packages/ui-tokens` | Colours, spacing and type shared by both UIs (with a WCAG AA contrast test).                                                                                                |
| `packages/config`    | Shared tsconfig, ESLint and Vitest presets.                                                                                                                                 |

## Data flow

1. **Sign-up / sign-in.** The master password is stretched with Argon2id on the device. One half
   authenticates to the server; the other unwraps the account key locally. The server only ever sees
   the authentication half, hashed again.
2. **Vault.** Items (logins, notes, cards, identities, TOTP, passkeys) are encrypted on the device
   with per-item keys. Only ciphertext and minimal metadata are stored on the server.
3. **Sync.** Clients keep a local copy and an outbox of pending changes, pull changes since their last
   revision and push with `If-Match`, so concurrent edits are detected instead of overwritten.
4. **Autofill.** The extension content script (and the Android autofill service) match a page or app
   to logins, show a Voult entry only, and fill after an explicit user action. Passkeys are created
   and used by a software authenticator in `packages/core`, with the private key stored in the vault.
5. **Backups.** A snapshot is the encrypted records plus KDF parameters and wrapped keys. It can be
   exported to a file or uploaded daily to your Google Drive (`drive.file` scope), and restored onto any
   server with only the master password.

## Releases

Pushing a `vX.Y.Z` tag runs [the release workflow](../.github/workflows/release.yml); see
[RELEASE.md](RELEASE.md). Only the app that changed since the previous tag is rebuilt.
