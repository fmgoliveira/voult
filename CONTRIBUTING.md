# Contributing to Voult

Thanks for helping! Bug reports, fixes, translations and ideas are all welcome. By participating you
agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md). Security problems go through the private
channel in [SECURITY.md](SECURITY.md), not public issues.

## Before you start

- For anything larger than a small fix, **open an issue first** so we can agree on the approach.
- Voult is zero-knowledge: the server must never see plaintext secrets or keys. Changes that weaken
  that (new data sent to the server, logging secrets, weaker KDF parameters) will not be accepted.
- Contributions are licensed under the project's [AGPL-3.0](LICENSE) license.

## Setup

Requires Node 22+ and pnpm 12.

```bash
pnpm install
pnpm build
pnpm test
```

Run the pieces:

```bash
pnpm --filter @voult/server dev              # sync server on :6565
pnpm --filter @voult/extension dev           # Chrome (dev:firefox for Firefox)
pnpm --filter @voult/mobile android          # needs the Android SDK and a device or emulator
```

Android specifics (dev client, autofill, Credential Manager) are in [docs/ANDROID.md](docs/ANDROID.md).

## Repository layout

| Path                 | What                                                  |
| -------------------- | ----------------------------------------------------- |
| `apps/extension`     | WXT (MV3) browser extension                           |
| `apps/mobile`        | Expo Android app and the Kotlin `voult-native` module |
| `apps/server`        | Hono sync server (SQLite)                             |
| `packages/core`      | crypto, schemas, vault ops, TOTP, generator, sync     |
| `packages/ui-tokens` | shared design tokens                                  |
| `packages/config`    | tsconfig, ESLint, Vitest presets                      |

More on how they fit together: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Making a change

1. Branch from `main` (one branch and pull request per change).
2. `packages/core` changes are **test-first**: add or change a test, then the code.
3. Run the checks CI runs before you push:

   ```bash
   pnpm format:check && pnpm lint && pnpm typecheck && pnpm test
   pnpm --filter @voult/extension e2e   # extension end-to-end (Playwright, Chromium)
   ```

   `pnpm format` fixes formatting. Everything must be green; CI also runs a dependency audit.

4. Add a line to [CHANGELOG.md](CHANGELOG.md).
5. Open a pull request that says what changed and why, and how you tested it. UI changes should
   include a screenshot (`SHOTS=1 pnpm --filter @voult/extension exec playwright test e2e/shots.spec.ts`
   renders the popup screens into `apps/extension/shots/`).

## Translations

Strings live in `packages/core/src/i18n/index.ts` (English is the source, European Portuguese is
included). Add a language by adding a dictionary with the same keys; a test keeps them in step.

## Style

TypeScript strict, ESLint and Prettier (formatting is enforced in CI). Keep comments for the _why_,
match the surrounding code, and prefer small, focused pull requests.
