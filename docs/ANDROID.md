# Voult for Android

An Expo (React Native) app with a small Kotlin module for the things JavaScript cannot do safely.
It uses the same sync server and the same `@voult/core` client code as the browser extension.

> **Status: phase 6 (MVP) — ready for its first real build.** The code type-checks, bundles for
> Android, and its storage/sync/PIN logic is unit-tested in Node, but it has **not been compiled or run
> on a device or emulator yet** (no Android SDK was available when it was written). Expect the first
> build to need a fix or two; section 8 says exactly what to send back. Autofill and passkeys for
> Android arrive in phase 7.

## What is in the app

- Create account / sign in, mandatory recovery kit, unlock with master password, **biometric** or **PIN**
- Vault list with search, type filter, sort, favourites and trash; item detail and editing for logins,
  notes, cards, identities and standalone 2FA codes; password generator (random + passphrase)
- **Codes** tab with live TOTP codes and countdown rings; **camera QR scanning** for `otpauth://` and
  Google Authenticator exports
- Offline-first SQLite cache, sync on open/resume/every minute, live updates over WebSocket while open
- Settings: auto-lock, clipboard clearing, theme, screenshot blocking, PIN/biometrics, change master
  password, device list and revoke
- Glass-style UI (aurora background, translucent cards, gradient icons) matching the extension

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

---

# Building and testing it yourself (Windows)

Budget about **1–2 hours** the first time (mostly downloads) and ~15 GB of disk. Steps 1–3 are one-off.

## 1. Install the Android toolchain

1. Install **Android Studio** (https://developer.android.com/studio). Accept the defaults; it installs
   the Android SDK and a bundled JDK.
2. Open it once → **More Actions → SDK Manager**:
   - **SDK Platforms**: tick **Android 15 (API 35)** (or the newest stable).
   - **SDK Tools**: tick **Android SDK Build-Tools**, **Android SDK Platform-Tools**,
     **Android SDK Command-line Tools**, **NDK (Side by side)** and **CMake**. (`expo-sqlite` compiles
     native C code, so NDK + CMake are required.) Click **Apply**.
3. Set environment variables (Windows search → "Edit the system environment variables" → *Environment
   Variables…*, user scope is fine):

   | Variable | Value |
   | --- | --- |
   | `ANDROID_HOME` | `C:\Users\<you>\AppData\Local\Android\Sdk` |
   | `JAVA_HOME` | `C:\Program Files\Android\Android Studio\jbr` |
   | `Path` (add two entries) | `%ANDROID_HOME%\platform-tools` and `%JAVA_HOME%\bin` |

   Open a **new** terminal and check:

   ```bash
   adb --version
   java -version      # 17 or newer
   ```

4. **Avoid the Windows path-length trap.** Native builds under `node_modules\.pnpm\…` can exceed 260
   characters. Enable long paths once (admin PowerShell), then reboot:

   ```powershell
   New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name LongPathsEnabled -Value 1 -PropertyType DWORD -Force
   git config --system core.longpaths true
   ```

   Keep the repo at a short path such as `C:\Dev\Personal\voult` (as it is now).

## 2. Pick a device

**Real phone (recommended — biometrics and camera just work).**
Settings → About phone → tap *Build number* 7 times → Settings → System → Developer options → turn on
**USB debugging**. Plug it in, accept the "Allow USB debugging?" prompt, then:

```bash
adb devices          # should list your phone as "device"
```

**Emulator.** Android Studio → Device Manager → *Create device* → Pixel 8, system image **API 35 (Google
APIs)**. For biometrics: emulator → *Settings → Security → Fingerprint* and enrol one in the emulated
Android settings; trigger a touch with *Extended controls (⋯) → Fingerprint*. The camera shows a virtual
scene; to scan a real QR code use *Extended controls → Camera* and point it at an image of a QR code.

## 3. Get the code ready

```bash
git checkout phase-6-android        # or main once PR #5 is merged
git pull
```

The repo installs a **flat `node_modules`** (`nodeLinker: hoisted` in `pnpm-workspace.yaml`). pnpm's
default layout uses Windows junctions and very long paths, which makes CMake/Ninja fail with
`build.ninja still dirty after 100 tries`. If you installed before this change, reinstall from scratch
and drop the old generated Android project (PowerShell):

```powershell
Remove-Item -Recurse -Force node_modules, apps\*\node_modules, packages\*\node_modules -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force apps\mobile\android -ErrorAction SilentlyContinue
pnpm install
pnpm --filter @voult/core --filter @voult/ui-tokens build    # the app imports these as built packages
```

## 4. Run a server the phone can reach

The app only accepts `https://` server URLs, except `http://localhost` which is allowed for testing.
Easiest is to run the server on your PC and tunnel its port to the phone:

```bash
# terminal A – start the server (Docker, see docs/INSTALL.md) OR without Docker, in PowerShell:
pnpm --filter @voult/server build
$env:JWT_SECRET = "0123456789012345678901234567890123456789"
$env:NODE_ENV = "production"; $env:PORT = "6565"
node apps/server/dist/main.js        # data goes to ./data/voult.db

# terminal B – forward the phone's localhost:6565 to your PC (repeat after reconnecting the phone)
adb reverse tcp:6565 tcp:6565
```

In the app use **`http://localhost:6565`** as the server URL. (For your real VM later, use its
`https://` URL.) Use a **throwaway account** for testing.

## 5. Build and install the dev build

```bash
cd apps/mobile
pnpm android
```

What happens: Expo generates the `android/` project (git-ignored, including the Kotlin module in
`modules/voult-native`), Gradle compiles everything (**first run 10–20 min**), installs the app on your
device and starts the Metro bundler. Leave that terminal open. Afterwards, `pnpm dev` starts only Metro
and the already-installed app reloads when you save a file.

If you only want an installable APK without Metro: `cd android && gradlew assembleRelease`, then
`adb install -r app\build\outputs\apk\release\app-release.apk` (debug-signed; fine for testing).

## 6. Smoke test (≈15 minutes)

Tick these off and note anything that looks wrong.

1. **Onboarding** — create the account, note the recovery secret appears, "Save or print recovery kit"
   opens the share sheet, *Continue* is disabled until you confirm. The empty vault appears.
2. **Add items** — add a Login (use the generate ✨ button), a Note, a Card and a 2FA code. Open each,
   reveal and copy a password, and check the toast ("…copied · clears in 30s").
3. **Sync with the extension** — sign in to the same account in the browser extension (docs/INSTALL.md).
   Add an item on the phone: it should show up in the extension within ~3 seconds; edit in the
   extension and watch the phone update.
4. **TOTP** — add the same secret to a reference app (Google Authenticator / Aegis) and to Voult: the
   6-digit codes must match. Then **Codes → QR button** and scan a real `otpauth://` QR code.
5. **Biometrics & PIN** — Settings → enable *Biometric unlock* and set a PIN. Settings → *Lock now*.
   Unlock with the fingerprint, then lock and unlock with the PIN. Enter a wrong PIN five times: the
   PIN option should disappear and the master password should still work.
6. **Auto-lock** — set auto-lock to *Immediately*, press Home, reopen: it should be locked.
7. **Screenshots** — take a screenshot of the vault: it should be blank/refused. (Settings → *Block
   screenshots* turns this off.)
8. **Offline** — switch on airplane mode, add an item (list shows a small amber dot / "waiting to
   sync"), switch it off: the dot disappears after a moment and the item appears in the extension.
9. **Argon2 speed** — time *Unlock* with the master password; the plan's target is **under 1 second**
   on a mid-range phone. Tell me roughly how long it takes.
10. **Dark mode** — Settings → Appearance → Dark.

## 7. Troubleshooting

| Symptom | Fix |
| --- | --- |
| `[CXX1101] NDK at ...\ndk\27.1.12297006 did not have a source.properties file` | That NDK folder is a half-finished download. Delete it (PowerShell): `Remove-Item -Recurse -Force "$env:LOCALAPPDATA\Android\Sdk\ndk\27.1.12297006"`, then simply rerun `pnpm android`: Gradle downloads the exact NDK/CMake it needs. If it does not, install them in Android Studio: **SDK Manager > SDK Tools > tick *Show Package Details* > NDK (Side by side) > 27.1.12297006** and **CMake > 3.22.1** > Apply. (The newer `sdkmanager.bat` now forwards to the "Android CLI" and mis-parses `ndk;27.1.12297006`, so prefer the GUI.) Expo pins this exact NDK version, so a different installed NDK does not help. |
| `SDK location not found` | `ANDROID_HOME` not set in the shell that runs `pnpm android`; open a new terminal. |
| `ninja: error: manifest 'build.ninja' still dirty after 100 tries` (in `react-native-screens` / `react-native-worklets`) | pnpm's junction layout confuses CMake. Use the flat install from step 3 (delete `node_modules` and `apps\mobile\android`, `pnpm install`, rebuild). |
| `ninja: error: … Filename too long` / other CMake errors | Enable long paths (step 1.4) and delete `apps/mobile/android` before retrying. |
| Gradle error in `voult-native` (Kotlin) | Expected possibility — send the full error (section 8). |
| `Could not find com.lambdapioneer.argon2kt` | Check internet/proxy; the library comes from Maven Central. |
| App opens but is white / "Unable to load script" | Metro isn't running or the phone can't reach it: `pnpm dev` and `adb reverse tcp:8081 tcp:8081`. |
| "Cannot reach the server" | Server not running, or run `adb reverse tcp:6565 tcp:6565` again. |
| Biometric option greyed out | No fingerprint/face enrolled in Android settings. |
| Start over | `adb uninstall com.franciscoliveira.voult` (wipes the local vault), delete `apps/mobile/android`, rerun `pnpm android`. |

## 8. What to send me

If something fails, paste:

1. The **last ~60 lines of the terminal** where the build failed (for Gradle: the part after `What went wrong`).
2. For a crash/blank screen: `adb logcat -d ReactNative:V ReactNativeJS:V AndroidRuntime:E *:S > log.txt`
   and the file (check it for anything private first — it should not contain secrets, but verify).
3. Which smoke-test step failed and a screenshot (screenshots are blocked in the vault by design —
   turn *Block screenshots* off in Settings for bug reports, then back on).

---

## Release APK for sideloading later

```bash
cd apps/mobile
npx eas-cli build -p android --profile preview     # needs an Expo account; produces an installable .apk
```

(Local alternative: `cd android && gradlew assembleRelease`, signing with your own keystore.)

## Automated checks

- `pnpm --filter @voult/mobile test` — SQLite store contract, the shared sync engine on SQLite, PIN/biometric logic
- `pnpm --filter @voult/mobile typecheck` and `pnpm --filter @voult/mobile build` (Metro export for Android)
- Maestro UI flows in `apps/mobile/.maestro` (not yet run)
