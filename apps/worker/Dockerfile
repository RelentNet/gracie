# Worker (Fastify + BullMQ) — build from the monorepo root as context.
#   docker build -f apps/worker/Dockerfile -t gracie-worker .
# Runs the TypeScript entrypoint directly via tsx (no compile step); all config
# comes from injected env vars (no .env.local in the image).
FROM node:24-bookworm-slim
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NODE_ENV=production
# ffmpeg powers screen-share still extraction (apps/worker/src/lib/stills.ts). Its
# absence is handled gracefully (stills are best-effort), but this image ships it so
# stills actually get captured. Rebuild + redeploy the worker to pick this up.
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate \
  && apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*
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
