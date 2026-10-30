# Changelog

## Unreleased

### Phase 5 — Autofill + passkeys (extension)

- Form detection heuristics (login, username-only step, register, change-password, OTP incl. split boxes), open shadow DOM and iframes; inline field icon + dropdown rendered in a closed shadow root that ignores scripted clicks
- PSL-based URL matching in core (domain / host / regex / never rules; no fill on plain http except loopback)
- Secrets stay in the background: the page only receives metadata until the user picks an item, then the value is returned to that frame after the background re-checks the frame's real URL
- TOTP autofill on the OTP step that follows a login fill; save / update password prompts (with "never for this site"); inline password generator for register/change forms
- Ctrl/Cmd+Shift+L command and context-menu entries (fill, generate)
- "Scan QR on this page" in the authenticator (tab capture + jsQR; otpauth:// and Google Authenticator exports)
- Passkeys: MAIN-world hook of `navigator.credentials.create/get`, picker window, signing in the background worker, counter persisted, fallback to the browser UI; per-site opt-out
- E2E against local fixture pages and a real `@simplewebauthn/server` relying party

### Phase 4 — Extension MVP

- Onboarding (create account / sign in on a new device), mandatory recovery kit (secret key + PDF download) before the first item can be saved
- Unlock with master password; optional memory-only quick-unlock PIN (Argon2id, 5 attempts then wiped); auto-lock on idle (1/5/15/60 min), screen lock and browser close; account key lives only in `storage.session`
- Offline-first local store (Dexie) with outbox, push/pull sync, 409 merge with password history, WebSocket push, rotating refresh tokens guarded by a Web Lock
- Popup: vault list (search, type/vault filter, sort, favourites/pins, trash with restore), item detail/edit for login/note/card/identity/2FA, password history, passkey list, generator (random + passphrase), authenticator tab with countdown rings and next-code preview, settings (auto-lock, clipboard clear, theme, PIN, change master password, devices)
- Clipboard auto-clear scheduled by the background worker (offscreen document on Chrome)
- Playwright e2e: create → lock → unlock → edit → sync across two Chromium profiles against a real server

### Phase 3 — Sync server

- Hono + SQLite (Drizzle) server: signup (closes after first account unless `MULTI_USER=true`), login, rotating refresh tokens with reuse detection, per-device sessions and revoke, change password (drops other devices)
- Auth key re-hashed with Argon2id at rest; fake prelogin for unknown emails; login limited to 5/min/IP
- Vault/item CRUD with per-user `rev`, `If-Match` optimistic concurrency (409 returns the current record), `/sync?since=`, trash purge job
- WebSocket "rev changed" push (token sent in first message, never in the URL)
- Items carry a client-chosen `version` (AAD) separate from the server `rev`; core snapshot updated accordingly
- Server is bundled with esbuild; Docker image installs only `better-sqlite3` natively

### Phase 2 — Core library (`@voult/core`)

- Key hierarchy: Argon2id (hash-wasm) -> HKDF auth/enc keys -> account key -> vault keys -> item keys; XChaCha20-Poly1305 with id+version AAD; recovery secret key; master-password change re-wraps only the account key
- Item zod schemas (login, note, card, identity, totp), password history (10), conflict resolution, trash retention
- Password generator (unbiased random + EFF large wordlist passphrases)
- TOTP/HOTP verified against RFC 4226/6238 vectors; otpauth:// and Google Authenticator migration QR parsing
- `.voult` encrypted snapshot (restorable with master password or recovery key), plaintext CSV/JSON export, Chrome/Firefox/1Password/Bitwarden/Proton Pass importers
- Software WebAuthn authenticator (ES256, none attestation) verified against @simplewebauthn/server

### Phase 1 — Foundation

- pnpm + Turborepo monorepo (`apps/extension`, `apps/mobile`, `apps/server`, `packages/core`, `packages/ui-tokens`, `packages/config`)
- Shared TypeScript strict, ESLint, Prettier, Vitest presets (core enforces 90 % coverage)
- WXT extension skeleton building Chrome + Firefox MV3
- Expo (dev client) Android app skeleton
- Hono server skeleton with `/health`
- GitHub Actions CI, Docker Compose + Caddy skeleton
