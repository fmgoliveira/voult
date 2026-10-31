# Changelog

## Unreleased

### Phase 9 — Hardening & release

- Password health (Settings, both apps): weak, reused and old passwords analysed on-device, plus an opt-in breach check against Have I Been Pwned using k-anonymity (only a 5-character hash prefix is sent)
- Import in both apps: Chrome/Edge/Brave and Firefox CSV, 1Password CSV, Bitwarden JSON (now including passkeys) and Proton Pass JSON, with a preview and skipped-entry report
- English / Portuguese (Settings -> Language, follows the device by default) for navigation, settings, sign-in and the new panels
- Accessibility: colour tokens verified against WCAG 2.1 AA in CI (muted text, success/warning colours and dark-mode button labels fixed)
- Android: Settings -> About with a manual "Check for updates" (GitHub Releases)
- Release pipeline: tag-driven workflow builds the signed APK, Chrome/Firefox packages, an AMO-signed Firefox `.xpi` with a self-hosted `updates.json`, and a Chrome Web Store draft (`docs/RELEASE.md`)
- Security: threat model and reviewer guide in `docs/SECURITY.md`; the high-severity zod advisory is fixed with a workspace override and CI now fails on `high`

### Phase 8 — Google Drive backup & restore

- Server: connect a Google account (OAuth, `drive.file` scope), a daily job uploads a self-contained encrypted snapshot to the "Voult Backups" Drive folder and keeps the newest 30; failures are recorded (retry after an hour) and shown in the clients; the refresh token is encrypted at rest; env `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`PUBLIC_URL`
- Extension and Android: Settings → Backup (connect, daily toggle, status/last error, Back up now, disconnect, export an encrypted `.voult` file); restore wizard on a fresh install from a Drive/local file with the master password only (shows item, 2FA and passkey counts plus a checksum before restoring, then recreates the account on any server)
- Core: `snapshotFromStore`, `restoreFromSnapshot`, backup API client; snapshots now carry the account email (older files ask for it)

### Phase 7 — Android autofill + passkey provider

- Kotlin `AutofillService` (one compact "Voult" row / keyboard chip that opens a bottom drawer with the matching logins, unlock, search, and "create new login" on sign-up forms; save prompt) reading an encrypted on-device index of labels and match keys; picking a suggestion opens a Voult screen over the other app that unlocks and decrypts only that login (works on a cold start)
- `CredentialProviderService` for Android 14+: create/use passkeys and passwords through Credential Manager; browsers via a privileged-caller allowlist, native apps verified through Digital Asset Links
- Core: `buildAutofillIndex`, Credential Manager JSON helpers (`parseCreateRequest`/`parseGetRequest`, `registrationResponseJson`/`authenticationResponseJson`), `getAssertion` accepts a browser-supplied client-data hash, registration results carry the SPKI public key
- Extension fix: `getPublicKey()` on a created passkey now returns the SPKI key as WebAuthn specifies (it returned the COSE key)
- Settings → Autofill & passkeys: status and shortcuts to Android's autofill / credential-provider settings
- Logins can be linked to an Android app (`androidapp://package`) from the "Fill with Voult" picker

### UI polish (extension + Android)

- Extension autofill: the logins list opens by itself when you focus an empty login field; arrow keys highlight an entry and Enter fills it (Enter only fills after an arrow key, so it still submits normally); typing, Tab or Escape closes the list and the text goes straight into the field
- Extension autofill with a locked vault: the list opens an unlock box (PIN if set, else master password) inside an extension iframe, so the website can never see what you type; click it or press ArrowDown to focus it, then the logins appear
- Quick-unlock PIN is now persistent (survives browser restarts): stored encrypted on the device, with a stronger Argon2id cost, wiped after 5 wrong attempts or on sign-out
- PIN fixes: unlocking with the master password no longer deletes the PIN; the lock screen shows only the PIN input (with a button for the master password) when a PIN exists; the PIN is set in Settings only
- Passkeys can be removed from a login (confirmation in both apps)
- Extension autofill: the logins list opens by itself when you focus an empty login field; arrow keys highlight an entry and Enter fills it (Enter only fills after an arrow key, so it still submits normally); typing, Tab or Escape closes the list and the text goes straight into the field
- Passkeys can be removed from a login (confirmation in both apps)
- PIN unlock fix: unlocking with the master password no longer deletes the PIN; the lock screen shows only the PIN input (with a button for the master password) when a PIN exists, and the PIN is set in Settings only
- Calmer, cleaner look in a single blue accent: near-flat backgrounds with one faint glow, opaque surfaces with hairline borders, no heavy blur or glow (`@voult/ui-tokens`, extension CSS)
- Android: removed shadows/elevation, which drew a dark rectangle under translucent inputs and cards
- Android: bottom-sheet drawers (new-item menu, confirmations, password generator); own toggle, checkbox and slider instead of the platform switch; cleaner Generator page with strength meter, sliders and per-option toggles; the generator drawer opens from the login editor with every option
- Extension: own dropdown (`Select`) and checkbox components instead of native controls
- Logins have one "email or username" field (inferred on save) with suggestions ranked by how many logins use each value
- Logins show the website's own `/favicon.ico` (fetched directly from the site, never via a third party; setting "Website icons"), falling back to the letter avatar
- Tap any field in a detail view to copy it, in both apps
- Page transitions in both apps (slide for detail/editor, fade between tabs)
- Extension: toolbar/store icon; setting "Open in a centred window" for a popup in the middle of the screen
- Core: `inferIdentifier`, `identifierSuggestions`, `faviconUrl`, password strength estimate

### Phase 6 — Android app MVP

- `@voult/core` gains a platform-neutral client: `ClientStore` contract, HTTP with rotating refresh, sync engine (push/pull/409 merge), vault client, account service, search + form helpers; pluggable Argon2id. The browser extension now runs on it (e2e unchanged and green)
- Expo Router app: onboarding, mandatory recovery kit, unlock (master password / biometric / PIN), vault list + detail + edit, trash, generator, authenticator with live codes and **camera QR scan**, settings, device list
- SQLite store (`expo-sqlite`) with the same contract tests; tokens in `expo-secure-store`
- Kotlin Expo module `voult-native`: native Argon2id, Keystore keys (biometric-gated and device-bound), `FLAG_SECURE`, sensitive clipboard copy with auto-clear
- Maestro flows and `docs/ANDROID.md`. **Not yet compiled or run on a device** (no Android SDK available)

### Deployment

- Removed Caddy; Docker Compose publishes the server on host port 6565 for your own reverse proxy
- Added `docs/INSTALL.md` (server, reverse proxy, extension) and a `zip` script for the extension

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
