# Installing Voult

Voult has two parts you install yourself: the **server** (a small Docker container that stores
only encrypted data) and the **browser extension**. The Android app has its own guide: [ANDROID.md](ANDROID.md).

## 1. Server (Docker)

The container listens on port `8787` inside Docker and is published on **host port 6565**.
It speaks plain HTTP: put your own reverse proxy in front of it to provide HTTPS.

### Requirements

- Docker with the Compose plugin
- A reverse proxy that terminates TLS for your domain (nginx, Traefik, Caddy, Cloudflare Tunnel…)

### Steps

```bash
git clone https://github.com/fmgoliveira/voult.git
cd voult
cp .env.example .env
```

Edit `.env` and set a secret of at least 32 random characters:

```bash
openssl rand -hex 32     # paste the output as JWT_SECRET=
```

| Variable      | Default  | Meaning                                                                                                      |
| ------------- | -------- | ------------------------------------------------------------------------------------------------------------ |
| `JWT_SECRET`  | required | Signs access tokens. Keep it private; changing it signs every device out.                                    |
| `MULTI_USER`  | `false`  | `false` closes signup after the first account (single-user). `true` lets anyone who can reach it sign up.    |
| `TRUST_PROXY` | `true`   | Read the client IP from `X-Forwarded-For` for the 5-logins-per-minute limit. Keep `true` behind a proxy.    |

### Google Drive backups (optional)

The server can upload a daily encrypted snapshot to a "Voult Backups" folder in your Google Drive and keep the newest 30. Google only ever sees ciphertext, and Voult only gets the narrow `drive.file` scope (it can see just the files it creates).

1. In [Google Cloud Console](https://console.cloud.google.com/) create a project, **enable the Google Drive API**, and configure the OAuth consent screen (External, add yourself as a test user, or publish it).
2. **Credentials → Create credentials → OAuth client ID → Web application.** Add the authorised redirect URI `https://<your server>/backup/google/callback` (it must match `PUBLIC_URL`).
3. Put these in `.env` and restart:

| Variable                | Default | Meaning                                                              |
| ----------------------- | ------- | -------------------------------------------------------------------- |
| `GOOGLE_CLIENT_ID`      | none    | OAuth client ID.                                                     |
| `GOOGLE_CLIENT_SECRET`  | none    | OAuth client secret.                                                 |
| `PUBLIC_URL`            | none    | The https URL clients use for this server (builds the redirect URI). |
| `BACKUP_INTERVAL_HOURS` | `24`    | How often each connected account is backed up.                       |
| `BACKUP_RETENTION`      | `30`    | Snapshots kept in the Drive folder.                                  |

4. In the extension or the Android app: **Settings → Backup → Connect Google Drive**, approve in the browser, then **Back up now** to test. The Drive refresh token is stored encrypted with a key derived from `JWT_SECRET`: if you change `JWT_SECRET`, reconnect Drive.

### Restoring after losing the server

You only need the master password and a backup file:

1. Download the newest file from Drive (`Voult Backups` folder), or use one you exported from Settings → Backup.
2. Start a fresh server (above), then in a fresh extension / app choose **Restore from a backup file**: pick the file, enter the master password, **Check backup** (shows the item / 2FA / passkey counts and a checksum), then **Restore to this server**. All your devices can then sign in with the same email and master password.

Start it:

```bash
docker compose up -d --build
curl http://localhost:6565/health      # → {"ok":true}
```

Data lives in the `voult-data` Docker volume (a SQLite file, ciphertext only). Back it up with (the volume name is prefixed with the Compose project name; check `docker volume ls`):

```bash
docker run --rm -v voult_voult-data:/data -v "$PWD":/backup alpine tar czf /backup/voult-data.tgz -C /data .
```

### Reverse proxy requirements

Whatever proxy you use must:

1. Forward `https://your-domain` to `http://<docker-host>:6565`.
2. **Allow WebSockets on `/ws`** (this is how other devices learn about changes within seconds).
3. **Set `X-Forwarded-For` to the real client IP, overwriting any value the client sent.** The server
   trusts the last entry of that header for rate limiting.

nginx example:

```nginx
server {
    listen 443 ssl http2;
    server_name vault.example.com;
    # ssl_certificate / ssl_certificate_key …

    client_max_body_size 2m;

    location / {
        proxy_pass http://127.0.0.1:6565;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;   # overwrite, don't append
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;          # WebSocket
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 1h;
    }
}
```

Port 6565 is unencrypted. Don't expose it to the internet; firewall it or bind it to localhost by
changing the mapping in `docker-compose.yml` to `'127.0.0.1:6565:8787'` when the proxy runs on the
same machine.

### Updating

```bash
git pull
docker compose up -d --build
```

### Without Docker

Node 22+ and pnpm 12:

```bash
pnpm install && pnpm --filter @voult/server build
JWT_SECRET=… NODE_ENV=production PORT=6565 DB_PATH=./data/voult.db node apps/server/dist/main.js
```

## 2. Browser extension

There is no store listing yet, so you build it from source and load it manually.

### Build

Requires Node 22+ and pnpm 12.

```bash
pnpm install
pnpm build            # produces apps/extension/.output/chrome-mv3 and firefox-mv3
pnpm --filter @voult/extension zip     # optional: .zip packages in apps/extension/.output
```

### Chrome, Edge, Brave

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose `apps/extension/.output/chrome-mv3`.
3. Pin Voult from the puzzle-piece menu.

### Firefox

Firefox only keeps unsigned add-ons until it restarts:

1. Open `about:debugging#/runtime/this-firefox`.
2. **Load Temporary Add-on…** and pick `apps/extension/.output/firefox-mv3/manifest.json`.

A permanent install needs a signed `.xpi` (see the plan's distribution step); that is not set up yet.

### First run

1. Click the Voult icon → **Create account**.
2. Expand **Server** and enter your public URL, e.g. `https://vault.example.com`
   (must be `https`; `http://localhost` and `http://127.0.0.1` are allowed for testing).
3. Choose a master password (12+ characters). **It cannot be reset.**
4. Download the **recovery kit** PDF and store it somewhere safe and offline, then tick the box to
   continue. Voult won't save items until you do.

To use another browser, choose **I already have an account** and sign in with the same email,
password and server URL. With `MULTI_USER=false` the server accepts only that one account.

### Keyboard shortcut

`Ctrl+Shift+L` (`Cmd+Shift+L` on macOS) fills the login on the current page. Rebind it at
`chrome://extensions/shortcuts` (Firefox: Add-ons → ⚙ → Manage Extension Shortcuts).

## Troubleshooting

- **"Cannot reach the server"** — check the URL, that the proxy forwards to port 6565, and that
  `curl https://your-domain/health` returns `{"ok":true}`.
- **Changes only appear after about a minute** — the WebSocket isn't getting through; make sure the
  proxy forwards `Upgrade`/`Connection` headers for `/ws`.
- **"Too many attempts"** — logins are limited to 5 per minute per IP. If every request seems to come
  from the proxy's IP, it isn't setting `X-Forwarded-For`.
- **"Signup is closed on this server"** — an account already exists. Sign in instead, or set
  `MULTI_USER=true` temporarily.
- **Lost the master password** — use the recovery kit's secret key (Unlock screen is on the roadmap);
  without either, the data cannot be recovered by anyone.
