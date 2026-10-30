# Voult

Self-hosted, zero-knowledge password manager with a built-in 2FA client and passkeys.
Chrome/Firefox extension + Android app, all TypeScript. See
[`docs/`](docs) for the requirements and implementation plan.

## Layout

| Path                 | What                                              |
| -------------------- | ------------------------------------------------- |
| `apps/extension`     | WXT (MV3) browser extension                       |
| `apps/mobile`        | Expo Android app (dev client)                     |
| `apps/server`        | Hono sync server                                  |
| `packages/core`      | crypto, schemas, vault ops, TOTP, generator, sync |
| `packages/ui-tokens` | shared design tokens                              |
| `packages/config`    | tsconfig, ESLint, Vitest presets                  |

## Development

Requires Node 22+ and pnpm 12.

```bash
pnpm install
pnpm build
pnpm test
pnpm --filter @voult/extension dev          # Chrome
pnpm --filter @voult/extension dev:firefox  # Firefox
pnpm --filter @voult/mobile android         # needs Android SDK + device
pnpm --filter @voult/server dev
```

Workflow: one branch + PR per phase sub-task; `packages/core` changes are test-first;
update `CHANGELOG.md`.
