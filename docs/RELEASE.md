# Releasing Voult

A release is a git tag `vX.Y.Z`. Pushing it runs `.github/workflows/release.yml`, which re-runs lint,
typecheck, tests and the dependency audit, stamps the version into every package
(`scripts/release-metadata.mjs set-version`), builds everything, and creates a GitHub Release.

```bash
git tag v1.0.0 && git push origin v1.0.0
```

## One-time setup (repository secrets)

| Secret                                                                                       | Used for                                                  |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`                     | Signing the APK. The job **fails** without them.         |
| `AMO_JWT_ISSUER`, `AMO_JWT_SECRET`                                                           | Signing the Firefox `.xpi` as an unlisted add-on.         |
| `CWS_EXTENSION_ID`, `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`                | Uploading a draft to the unlisted Chrome Web Store item.  |

Create the Android key once and keep a copy somewhere safe: **a lost key means users must uninstall
before updating**.

```bash
keytool -genkeypair -v -keystore voult-release.keystore -alias voult -keyalg RSA -keysize 4096 -validity 10000
base64 -w0 voult-release.keystore      # paste as ANDROID_KEYSTORE_B64
```

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
