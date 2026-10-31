# Releasing Voult

A release is a git tag `vX.Y.Z`. Pushing it runs `.github/workflows/release.yml`, which re-runs lint,
typecheck, tests and the dependency audit, stamps the version into every package
(`scripts/release-metadata.mjs set-version`), builds everything, and creates a GitHub Release.

```bash
git tag v1.0.0 && git push origin v1.0.0
```

## One-time setup (repository secrets)

Add each one in GitHub: **Settings -> Secrets and variables -> Actions -> New repository secret**, or
with the CLI: `gh secret set NAME` (it prompts for the value). You can set up only the parts you need:
without the Firefox or Chrome secrets those jobs skip themselves; **without the Android secrets the
Android job fails on purpose**, so it never publishes a debug-signed APK.

### Android signing (required for the APK)

Create the key once, on your own machine, and keep the `.keystore` file and its password somewhere safe
(a password manager, plus an offline copy): **if you lose it, nobody can update the app without
uninstalling it first**, and that wipes the local vault cache.

```bash
keytool -genkeypair -v -keystore voult-release.keystore -alias voult   -keyalg RSA -keysize 4096 -validity 10000
```

`keytool` asks for a password (the same value is used for the keystore and the key) and some name
fields. Then:

| Secret                      | What to put in it                                                                                                |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `ANDROID_KEYSTORE_B64`      | The whole keystore file as one line of base64: `base64 -w0 voult-release.keystore` (on Windows PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("voult-release.keystore"))`). |
| `ANDROID_KEYSTORE_PASSWORD` | The password you typed for `keytool`.                                                                            |
| `ANDROID_KEY_ALIAS`         | The alias: `voult` if you used the command above.                                                                |

### Firefox signing (optional; produces the self-updating `.xpi`)

Without it you still get the unsigned Firefox zip, which can only be installed temporarily in Firefox.

1. Sign in at <https://addons.mozilla.org/developers/> and open **Tools -> Manage API Keys**
   (<https://addons.mozilla.org/developers/addon/api/key/>), then **Generate new credentials**.
2. Copy the two values it shows:

| Secret           | What to put in it                                              |
| ---------------- | -------------------------------------------------------------- |
| `AMO_JWT_ISSUER` | "JWT issuer", looks like `user:12345678:123`.                   |
| `AMO_JWT_SECRET` | "JWT secret", a long hex string (shown once, copy it now).      |

The add-on id `voult@franciscoliveira.com` is already in the manifest. The workflow submits the build as
an **unlisted** add-on, so Mozilla signs it automatically without a public listing.

### Chrome Web Store upload (optional; uploads a draft, you click Publish)

1. In the [developer dashboard](https://chrome.google.com/webstore/devconsole) create the item once by
   uploading `voult-*-chrome.zip` by hand and setting its visibility to **Unlisted**. The item id
   (32 letters) is in its URL.
2. In [Google Cloud Console](https://console.cloud.google.com/) create or pick a project, enable the
   **Chrome Web Store API**, configure the OAuth consent screen, and create an OAuth client of type
   **Desktop app**. That gives a client id and secret.
3. Get a refresh token for the scope `https://www.googleapis.com/auth/chromewebstore` (the easiest way is
   the guide at <https://github.com/fregante/chrome-webstore-upload-keys>; sign in with the Google
   account that owns the store item).

| Secret                | What to put in it                                       |
| --------------------- | ------------------------------------------------------- |
| `CWS_EXTENSION_ID`    | The 32-letter item id from the dashboard URL.            |
| `CWS_CLIENT_ID`       | The OAuth client id from step 2.                         |
| `CWS_CLIENT_SECRET`   | The OAuth client secret from step 2.                     |
| `CWS_REFRESH_TOKEN`   | The refresh token from step 3.                           |

Nothing else needs a secret: the GitHub Release itself uses the workflow's built-in token.

## What gets published

- `voult-X.Y.Z.apk`: signed with your key (verify with `apksigner verify --print-certs`).
- `voult-*-chrome.zip` / `voult-*-firefox.zip`: store packages (also the sources for review).
- `voult-firefox.xpi` + `updates.json`: Firefox installs the `.xpi` from the release; the manifest's
  `update_url` points at `releases/latest/download/updates.json`, so Firefox updates itself.
- Chrome: the draft appears in the Web Store developer dashboard (an unlisted item); click **Publish**
  there. Chrome then updates installs automatically.

## Updates for users

- **Android:** Settings -> About -> *Check for updates* asks the GitHub Releases API and offers the APK
  link. It only runs when tapped, and the new version is installed by you.
- **Firefox / Chrome:** handled by the browser (see above).
- **Server:** `git pull && docker compose up -d --build`; the database migrates itself on start.

## Before tagging

1. `pnpm lint && pnpm typecheck && pnpm test && pnpm --filter @voult/extension e2e`
2. Walk through the smoke tests in `docs/ANDROID.md` section 6 on a real phone.
3. Update `CHANGELOG.md`.
