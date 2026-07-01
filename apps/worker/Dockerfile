# Worker (Fastify + BullMQ) — build from the monorepo root as context.
#   docker build -f apps/worker/Dockerfile -t gracie-worker .
# Runs the TypeScript entrypoint directly via tsx (no compile step); all config
# comes from injected env vars (no .env.local in the image).
FROM node:24-bookworm-slim
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app

# Install workspace deps first (better layer caching).
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/config/package.json packages/config/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/db/package.json packages/db/package.json
COPY apps/worker/package.json apps/worker/package.json
RUN pnpm install --frozen-lockfile

COPY . .

ENV PORT=3001 HOST=0.0.0.0
EXPOSE 3001
CMD ["pnpm", "--filter", "worker", "start"]
