#!/usr/bin/env bash
# One-shot, re-runnable setup for the demo stack. Run ON THE SERVER from the stack
# directory (the one holding docker-compose.yml and ./src):
#   bash setup.sh
#
# 1. Creates .env with freshly generated secrets — only if it doesn't exist, and
#    never prints them.
# 2. Starts Postgres + MinIO, gives PostgREST's login role its password.
# 3. Applies the schema + every migration — only on a fresh database.
# 4. Creates the storage bucket.
# 5. Builds and starts everything.
#
# It does NOT seed data or set the AI key — see README.md for those.
set -euo pipefail
cd "$(dirname "$0")"

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
mint_jwt() { # role secret
  local header payload sig
  header=$(printf '{"alg":"HS256","typ":"JWT"}' | b64url)
  payload=$(printf '{"role":"%s","iss":"demo","exp":1983812996}' "$1" | b64url)
  sig=$(printf '%s.%s' "$header" "$payload" | openssl dgst -sha256 -hmac "$2" -binary | b64url)
  printf '%s.%s.%s' "$header" "$payload" "$sig"
}

if [ ! -f .env ]; then
  jwt_secret=$(openssl rand -hex 32)
  umask 077
  cat > .env <<EOF
POSTGRES_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=${jwt_secret}
SUPABASE_ANON_KEY=$(mint_jwt anon "$jwt_secret")
SUPABASE_SERVICE_ROLE_KEY=$(mint_jwt service_role "$jwt_secret")
S3_ACCESS_KEY_ID=demo$(openssl rand -hex 8)
S3_SECRET_ACCESS_KEY=$(openssl rand -hex 24)
APP_ENCRYPTION_KEY=$(openssl rand -base64 32)
EOF
  chmod 600 .env
  echo "created .env (secrets generated, not shown)"
else
  echo ".env exists — keeping it"
fi

# shellcheck disable=SC1091
set -a; . ./.env; set +a

docker compose up -d db minio
echo -n "waiting for postgres"
until [ "$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q db)")" = healthy ]; do
  echo -n .; sleep 2
done
echo

psql_db() { docker compose exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d postgres "$@"; }

psql_db -q -c "alter role authenticator with password '${POSTGRES_PASSWORD}';"

if [ "$(psql_db -tAc "select to_regclass('public.clients') is not null")" = "t" ]; then
  echo "schema already present — skipping"
else
  echo "applying schema"
  psql_db -q < src/docs/04-database-schema.sql
  for f in $(ls src/packages/db/migrations/*.sql | sort); do
    echo "  $(basename "$f")"
    psql_db -q < "$f"
  done
fi

docker run --rm --network demo_internal \
  -e MC_HOST_local="http://${S3_ACCESS_KEY_ID}:${S3_SECRET_ACCESS_KEY}@minio:9000" \
  quay.io/minio/mc mb --ignore-existing local/demo

docker compose up -d --build
echo "stack up — see README.md for seeding"
