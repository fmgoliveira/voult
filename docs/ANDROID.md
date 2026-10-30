# Voult for Android

An Expo (React Native) app with a small Kotlin module for the things JavaScript cannot do safely.
It uses the same sync server and the same `@voult/core` client code as the browser extension.

> **Status: phase 6 (MVP).** The code type-checks, bundles for Android, and its storage/sync/PIN logic is
> unit-tested in Node, but it has **not been compiled or run on a device or emulator yet** (no Android
> SDK was available when it was written). Treat the first build as a shakedown. Autofill and passkeys
> for Android arrive in phase 7.

## What is in the app

- Create account / sign in, mandatory recovery kit, unlock with master password, **biometric** or **PIN**
- Vault list with search, type filter, sort, favourites and trash; item detail and editing for logins,
  notes, cards, identities and standalone 2FA codes; password generator (random + passphrase)
- **Codes** tab with live TOTP codes; **camera QR scanning** for `otpauth://` and Google Authenticator exports
- Offline-first SQLite cache, background-safe sync, live updates over WebSocket while the app is open
- Settings: auto-lock, clipboard clearing, theme, screenshot blocking, PIN/biometrics, change master
  password, device list and revoke

## Security details

| Concern | How it is handled |
| --- | --- |
| Argon2id | Native (argon2kt), because Hermes has no WebAssembly. Same parameters as the extension. |
| Biometric unlock | The account key is sealed by an Android Keystore AES-GCM key that needs a fresh **strong biometric** for every use (StrongBox when available) and is destroyed if biometrics are re-enrolled. |
| PIN unlock | Account key wrapped by Argon2id(PIN), then sealed again by a hardware-backed Keystore key. Five wrong tries delete it. |
| Tokens | Refresh token in `expo-secure-store` (Keystore-backed); access token in memory only. |
| Screens | `FLAG_SECURE` blocks screenshots, screen recording and the recents thumbnail (setting, on by default). |
| Clipboard | Copies are flagged `EXTRA_IS_SENSITIVE` so Android 13+ hides them from previews, and cleared after the configured delay. Android 10+ only lets the foreground app clear the clipboard, so a clear while the app is backgrounded may be refused; it is retried when you return. |
| Auto-lock | On leaving the app after the chosen delay (or immediately). The decrypted key only ever lives in memory. |
| Backups | `allowBackup` is off so the SQLite cache and secure-store entries are not copied to Google backups. |

## Building

Requirements: Node 22, pnpm 12, JDK 17+, Android Studio (SDK 34+), a device or emulator.

```bash
pnpm install
pnpm --filter @voult/mobile android      # prebuilds ./android, compiles the dev client, installs it
pnpm --filter @voult/mobile dev          # Metro bundler (in another terminal)
```

`expo run:android` generates the `android/` project (git-ignored) including the local module in
`apps/mobile/modules/voult-native`. If Gradle fails there, the Kotlin module is the first suspect; please
send the error.

### Talking to your server

The app requires `https://` server URLs. For local testing use plain HTTP on loopback and forward the
port to the phone:

```bash
adb reverse tcp:6565 tcp:6565     # then use http://localhost:6565 as the server URL
```

### Release APK (sideloading)

```bash
cd apps/mobile
npx eas-cli build -p android --profile preview     # needs an Expo account; produces an installable .apk
```

(Local alternative: `cd android && ./gradlew assembleRelease` after prebuild, signing with your own keystore.)

## Checks

- `pnpm --filter @voult/mobile test` — SQLite store contract, the shared sync engine on SQLite, PIN/biometric logic
- `pnpm --filter @voult/mobile typecheck` and `pnpm --filter @voult/mobile build` (Metro export for Android)
- Maestro UI flows in `apps/mobile/.maestro` (not yet run)

### Manual acceptance checks (phase 6)

1. Create an account on the phone, add a login, see it appear in the extension within ~3 seconds, and vice versa.
2. Add the same TOTP secret to a reference authenticator and to Voult: the codes match.
3. Scan a QR code from your screen with **Codes → scan**.
4. Enable biometrics and PIN; lock; unlock with each; enter a wrong PIN five times and confirm it is removed.
5. Confirm a screenshot of the vault shows a blank/black image.
6. Copy a password, wait for the clear delay, paste elsewhere.
