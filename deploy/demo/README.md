# Demo stack — demo.olvyx.com

The white-label demo on the Unraid box: the app, Postgres + PostgREST (the only part
of Supabase the app uses), a one-route nginx, and MinIO. Lives in
`/mnt/user/appdata/demo/` with the app source unpacked under `./src`.

It runs with **no app login** — it signs everyone in as the seeded admin. It is only
safe because Authelia sits in front of it (SWAG proxy-conf + an Authelia rule). Never
expose it without that.

## First deploy

The app image is built on a workstation and shipped — never on the Unraid box. A
`pnpm install` + `next build` there drove it to load 250 with ~200 MB free, next to
Emby, Ollama and the rest. Running the image costs a few hundred MB.

From the repo on your machine (`core.autocrlf=false` keeps Windows line endings out
of the shell script and SQL the server runs):

```bash
git -c core.autocrlf=false archive --format=tar HEAD | ssh unraid 'mkdir -p /mnt/user/appdata/demo/src && tar -x -C /mnt/user/appdata/demo/src'
scp deploy/demo/docker-compose.yml deploy/demo/gateway.conf deploy/demo/setup.sh unraid:/mnt/user/appdata/demo/
docker build -f apps/web/Dockerfile -t demo-web:latest .
docker save demo-web:latest | gzip | ssh unraid 'gunzip | docker load'
ssh unraid 'cd /mnt/user/appdata/demo && bash setup.sh'
```

The `src/` copy on the server is only for the schema and migrations `setup.sh` applies.

## Seed (and re-seed on the morning of a demo)

Dates are placed relative to the day the seed runs, so a stale seed empties the
dashboard. `DEMO_SEED_TARGET=gateway` is the deliberate opt-in the seed requires
for a non-local database.

```bash
ssh unraid 'cd /mnt/user/appdata/demo && docker compose exec -e DEMO_SEED_TARGET=gateway web ./apps/web/node_modules/.bin/tsx packages/db/seed/demo-cbg.ts'
ssh unraid 'cd /mnt/user/appdata/demo && docker compose exec -e DEMO_SEED_TARGET=gateway web ./apps/web/node_modules/.bin/tsx packages/db/seed/demo-embed.ts'
```

The embed step needs the AI key, so on a fresh stack: seed, set the key, then embed.

## AI key

Set it in the app: **Settings → AI Provider → OpenRouter**, paste the key, Save. It is
stored encrypted in the database and survives re-seeding.

## Update the app

Rebuild and ship the image, then recreate the container:

```bash
docker build -f apps/web/Dockerfile -t demo-web:latest .
docker save demo-web:latest | gzip | ssh unraid 'gunzip | docker load && cd /mnt/user/appdata/demo && docker compose up -d web'
```
