# Changelog

## Unreleased

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
