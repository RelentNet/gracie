# hq on rai — interim Docker Compose deploy

The RelentNet instance on `rai` (10.200.200.44), until Coolify owns it (REL-290).
It is the demo stack (see `deploy/demo/README.md`) plus Logto for sign-in:

| | |
|---|---|
| App | **http://10.200.200.44:3000** (LAN IP only) |
| Logto sign-in pages | http://10.200.200.44:3001 (LAN IP only) |
| Logto admin console | http://127.0.0.1:3002 on rai's loopback — SSH tunnel only |

Lives in `/opt/hq/` on rai, operated through the `relentnet` SSH alias. Keep it all
on the LAN; nothing here is meant to be public until REL-319.

## First deploy

From the repo root on your machine:

```bash
ssh relentnet 'sudo -n install -d -o brandon -g brandon /opt/hq/src'
git -c core.autocrlf=false archive --format=tar HEAD | ssh relentnet 'tar -x -C /opt/hq/src'
# From the archive, not the working copy: on Windows the working copy has CRLF
# line endings, which break the scripts on the server.
ssh relentnet 'cd /opt/hq && cp src/deploy/rai/docker-compose.yml src/deploy/rai/logto-connect.sh src/deploy/demo/gateway.conf src/deploy/demo/setup.sh .'
docker build -f apps/web/Dockerfile -t hq-web:latest .
docker save hq-web:latest | gzip | ssh relentnet 'gunzip | docker load'
ssh relentnet 'cd /opt/hq && bash setup.sh'
```

Until sign-in is turned on (below), `.env` carries `ALLOW_MOCK_AUTH=true` and everyone
who reaches the app is the seeded admin.

## Turn on sign-in (Logto)

1. **Open the admin console** through an SSH tunnel, from your machine:
   ```bash
   ssh -N -L 3002:127.0.0.1:3002 relentnet
   ```
   Then browse to **http://127.0.0.1:3002** (use `127.0.0.1`, not `localhost`). The
   first visit creates the Logto admin account — use a strong password and turn on
   MFA for it.
2. **Sign-in experience** (Sign-in & account): sign-in only (no self-registration),
   identifier **Email address** with **password**. Multi-factor auth: require TOTP
   (authenticator app).
3. **Create the app** (Applications → Create application → *Traditional Web*, name
   `hq`):
   - Create it under **My apps**, NOT *Third-party apps*. A third-party app may only
     request scopes users consent to, so sign-in fails with `invalid_scope` ("requested
     scope is not allowed") and the callback returns a 500. The flag can't be changed
     in the console afterwards.
   - Redirect URI: `http://10.200.200.44:3000/callback`
   - Post sign-out redirect URI: `http://10.200.200.44:3000`
   - Save, then keep the page open for its App ID and App secret.
4. **Create the users** (User management → Add user) with each person's email. Logto
   shows a one-time password to hand over.
5. **Connect the app** — on rai, it asks for the App ID and secret (the secret is not
   echoed), writes `.env`, removes `ALLOW_MOCK_AUTH` and restarts the app:
   ```bash
   ssh -t relentnet 'cd /opt/hq && bash logto-connect.sh'
   ```
6. **Sign in** at http://10.200.200.44:3000. A first sign-in creates your `users` row as
   a **viewer**; make yourself admin (roles live in gracie's database):
   ```bash
   ssh relentnet "cd /opt/hq && docker compose exec -T db psql -U postgres -d postgres -c \"update users set role='admin' where email='you@relentnet.com'\""
   ```
   It applies on the next request — no need to sign in again.

## Seed

```bash
ssh relentnet 'cd /opt/hq && docker compose exec -e DEMO_SEED_TARGET=gateway web ./apps/web/node_modules/.bin/tsx packages/db/seed/demo-cbg.ts'
```

Then set the AI key in the app (Settings → AI Provider → OpenRouter) and run
`demo-embed.ts` the same way.

## Update the app

```bash
docker build -f apps/web/Dockerfile -t hq-web:latest .
docker save hq-web:latest | gzip | ssh relentnet 'gunzip | docker load && cd /opt/hq && docker compose up -d web'
```
