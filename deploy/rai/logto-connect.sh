#!/usr/bin/env bash
# Turn sign-in on: run ON rai from /opt/hq after creating the app in the Logto
# console (see README.md). Prompts for the App ID and App secret (the secret is not
# echoed), writes them to .env, removes ALLOW_MOCK_AUTH, and restarts the app.
# Re-runnable: replaces any previous values.
set -euo pipefail
cd "$(dirname "$0")"

read -rp 'Logto App ID: ' app_id
read -rsp 'Logto App secret (hidden): ' app_secret
echo
if [ -z "$app_id" ] || [ -z "$app_secret" ]; then
  echo 'Both are required — nothing changed.'
  exit 1
fi

sed -i '/^LOGTO_APP_ID=/d; /^LOGTO_APP_SECRET=/d; /^ALLOW_MOCK_AUTH=/d' .env
printf 'LOGTO_APP_ID=%s\nLOGTO_APP_SECRET=%s\n' "$app_id" "$app_secret" >> .env
chmod 600 .env

docker compose up -d web
echo 'Sign-in is on: open http://10.200.200.44:3000'
