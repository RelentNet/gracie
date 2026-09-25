# hq on rai — interim Docker Compose deploy

The RelentNet instance on `rai` (10.200.200.44), until Coolify owns it (REL-290).
It is the demo stack (see `deploy/demo/README.md`) with the app published on rai's
LAN address: **http://10.200.200.44:3000**.

**No login yet.** Everyone who reaches it is the seeded admin until real sign-in
lands (REL-291). Keep it on the LAN; don't tunnel or proxy it anywhere public.

Lives in `/opt/hq/` on rai, operated through the `relentnet` SSH alias.

## First deploy

From the repo root on your machine:

```bash
ssh relentnet 'sudo -n install -d -o brandon -g brandon /opt/hq/src'
git -c core.autocrlf=false archive --format=tar HEAD | ssh relentnet 'tar -x -C /opt/hq/src'
# From the archive, not the working copy: on Windows the working copy has CRLF
# line endings, which break setup.sh on the server.
ssh relentnet 'cd /opt/hq && cp src/deploy/rai/docker-compose.yml src/deploy/demo/gateway.conf src/deploy/demo/setup.sh .'
docker build -f apps/web/Dockerfile -t hq-web:latest .
docker save hq-web:latest | gzip | ssh relentnet 'gunzip | docker load'
ssh relentnet 'cd /opt/hq && bash setup.sh'
```

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
