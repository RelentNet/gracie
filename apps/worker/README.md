# @gracie/worker

Fastify + BullMQ service — long-running pipeline jobs and scheduled crons (D1/D2).
This is the foundation: a real BullMQ service against the self-hosted Redis, plus
one sample **heartbeat** job. The AI pipeline (P5) and calendar crons (P4) extend
the factory pattern here later.

## Run

```bash
pnpm --filter worker dev      # tsx watch, loads apps/worker/.env.local
pnpm --filter worker start    # one-shot run
pnpm --filter worker build    # tsc compile-check (no emit)
pnpm --filter worker typecheck
pnpm --filter worker lint
```

## Environment

`apps/worker/.env.local` (git-ignored — copy the dev `REDIS_URL` from
`docs/SECRETS.md` → Redis):

| Var | Required | Default | Notes |
| --- | --- | --- | --- |
| `REDIS_URL` | ✅ | — | BullMQ backing store. Worker fails fast if unset. |
| `WORKER_PORT` | ❌ | `3001` | Avoids colliding with `apps/web` (`:3000`). |
| `WORKER_HOST` | ❌ | `0.0.0.0` | Fastify bind host. |

## Endpoints

- `GET /health` → `200 { status, redis }` — `redis` reflects a live `PING`.
- `/admin/queues` — Bull Board UI. **No auth**: internal-network-only in prod
  (the worker is not exposed via the Cloudflare Tunnel — docs/01). No auth needed
  in dev.

## Layout

```
src/
├── index.ts                     # bootstrap + graceful shutdown
├── server.ts                    # Fastify app (health + Bull Board)
├── lib/
│   ├── env.ts                   # env load + fail-fast validation
│   └── redis.ts                 # single shared ioredis connection
├── queues/
│   ├── factory.ts               # createQueue / createWorker (+ default job opts)
│   └── heartbeat.queue.ts       # sample queue + repeatable schedule
└── processors/
    └── heartbeat.processor.ts   # logs one line per tick
```

Queue names and job-payload types are the shared contract in
`@gracie/shared` (`QUEUE_NAMES`, `HeartbeatJobPayload`) so the web app can enqueue
against the same names in later phases.
