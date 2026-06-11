# Delegation Brief — Worker Foundation (`apps/worker` → real BullMQ service)

> Self-contained brief for a fresh Claude Code session. You have no prior context;
> read the files in §0 first. **Platform:** Windows 11, Node 24, pnpm 10.33.0 via
> corepack (if `pnpm` isn't on PATH, use `corepack pnpm@10.33.0`). Shell: PowerShell.

## 0. Read first (cold-start context)
- `docs/HANDOFF.md` — current project state (Logto is live; infra is up).
- `docs/00-overview.md`, `docs/01-architecture.md` (§5 job queue, §6 cron jobs),
  `docs/02-tech-decisions.md` (**D1** monorepo `apps/web`+`apps/worker`+`packages/*`,
  **D2** BullMQ+Redis), `docs/03-project-structure.md`.
- `docs/06-ai-pipeline.md` §9 (why queued + sequential) — how the pipeline will use
  queues later (you are NOT building the pipeline now).
- Skim the current `apps/worker/` (Fastify stub), `packages/shared`, `packages/db`.

## Global rules (non-negotiable)
- Never reintroduce removed services (Make.com / Google Drive / Otter / tldv / Gmail-send).
- **Never commit secrets.** `docs/SECRETS.md` and `*.env.local` are git-ignored —
  confirm with `git check-ignore` before any `git add`.
- **Verify before claiming done** (typecheck + lint + the §Acceptance checks).
- Match the codebase style: strict TS, `readonly`, explicit return types, `.js`
  import specifiers (NodeNext), JSDoc headers. Keep `packages/shared` client-safe
  (no Node-only or `bullmq` imports there).
- Commit + push to `main` after the milestone is verified.

## Infra already provisioned (do NOT recreate)
- **Redis** (BullMQ backing store) is live: Coolify db `gracie-redis`, reachable in
  dev via a socat proxy at `10.200.200.131:6380` (AUTH required; password is in the
  URL). `REDIS_URL` is already in `apps/web/.env.local` and `docs/SECRETS.md`
  (Redis section). Verified working (PING→PONG). The prod/internal URL (for when the
  worker is deployed on Coolify) is also in SECRETS.md.

## Scope — build this
Turn `apps/worker` from a stub into a real **Fastify + BullMQ** service:

1. **Env**: create `apps/worker/.env.local` containing `REDIS_URL` (copy the dev value
   from `docs/SECRETS.md` → Redis). Load it in the dev/start scripts (Node `--env-file`
   or `dotenv`). Fail fast with a clear message if `REDIS_URL` is missing.
2. **Deps**: add `bullmq`, `ioredis`, `fastify` (if not already), `@bull-board/api`,
   `@bull-board/fastify`.
3. **Redis connection**: one shared ioredis connection from `REDIS_URL` with BullMQ's
   required option `maxRetriesPerRequest: null`.
4. **Queue infrastructure** (the reusable pattern P4/P5 will extend):
   - In `packages/shared`: **queue-name constants** + **job-payload TS types** only
     (pure — no `bullmq`/Node imports). e.g. a `QUEUE_NAMES` const and a sample payload.
   - In `apps/worker/src`: small factories to build a `Queue` and a `Worker` for a
     given queue name + processor, sharing the connection, with sane defaults
     (`attempts`, exponential `backoff`) per `docs/06` §8.
5. **Sample job** (proves the loop, no external deps): a `heartbeat` queue with a
   **repeatable** job (~every 30s) whose processor logs a line.
6. **Fastify app**:
   - `GET /health` → 200 `{ status, redis: 'ok' | 'down' }` (does a Redis PING).
   - Mount **Bull Board** at `/admin/queues` (comment that it's internal-network-only
     in prod; no auth needed in dev).
   - Bind to a dev port that doesn't collide with the web app's `3000` (suggest `3001`);
     document it.
7. **Graceful shutdown**: close workers, queues, Fastify, and the Redis connection on
   SIGINT/SIGTERM (no hanging handles).
8. Wire `apps/worker` scripts (`dev`, `start`, `build`, `typecheck`, `lint`) consistent
   with the other workspaces.

## Out of scope (DO NOT build — later phases)
- The AI pipeline / document generation (P5), calendar scan + bot-dispatch crons (P4),
  any OpenAI / Recall / MS Graph calls. Foundation + one trivial sample job only.
- Enqueuing from the web app (P4/P5). The sample job is enqueued by the worker itself.

## Acceptance (all must pass before commit)
- `pnpm -w typecheck` and `pnpm -w lint` pass.
- `pnpm --filter worker dev` starts, connects to Redis with no errors, and the
  **heartbeat processor logs on schedule**.
- `GET http://localhost:<port>/health` → 200 with `redis: 'ok'`.
- **Bull Board** loads at `/admin/queues` and shows the queue.
- Ctrl-C shuts down cleanly.
- Commit + push to `main`; confirm `git status` shows no `.env.local`/secrets staged.

## Escalate (stop + ask) if
- Redis is unreachable from dev (verify `10.200.200.131:6380` is reachable; the proxy
  container is `gracie-dev-redis-proxy` on the VM).
- BullMQ/ioredis ESM/NodeNext interop issues you can't cleanly resolve.
- A queue-topology decision would meaningfully constrain P4/P5 — ask, don't guess.
