# Security policy

Voult stores people's passwords, so security reports are taken seriously and handled privately.

## Reporting a vulnerability

**Please do not open a public issue.** Use GitHub's private reporting instead:

1. Go to the [Security tab](https://github.com/fmgoliveira/voult/security/advisories/new) of this repository.
2. Choose **Report a vulnerability** and describe what you found: the affected component (server,
   extension, Android app, `packages/core`), steps to reproduce, and the impact you think it has.

You will get a first answer within 7 days. A confirmed issue is fixed in a private branch, released,
and then disclosed in the release notes and a GitHub security advisory, crediting you if you want.

## Scope

In scope: the cryptography in `packages/core`, authentication and sync in `apps/server`, the
extension (including autofill and passkey handling) and the Android app (including the autofill and
credential provider services).

Out of scope: issues that need a rooted device or an already-compromised browser profile, social
engineering, denial of service by volume, and findings in third-party services (Google, GitHub, your
reverse proxy) rather than in Voult itself.

## Supported versions

Only the latest release receives security fixes. Self-hosters update the server with
`git pull && docker compose up -d --build` (the database migrates itself).

## Design notes

How the encryption, key hierarchy and threat model work, and what has and has not been reviewed, is
written down in [docs/SECURITY.md](docs/SECURITY.md). Voult has had a self-review but **no
independent external audit yet**; keep that in mind before trusting it with anything critical.
