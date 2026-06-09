# 11 — Infrastructure Runbook (Self-Hosted Proxmox)

> Step-by-step to stand up the GA App stack on the Proxmox host.
> Order matters: VM → Coolify → networking → services → verify.
> Decisions: D10 (Proxmox VM), D15 (self-host everything), D16 (MinIO).
>
> **Secrets:** record every credential you create into the git-ignored
> `docs/SECRETS.md`. Never commit them.

---

## DEPLOYED STATE (as of initial buildout)

> Live infrastructure. Credentials are in git-ignored `docs/SECRETS.md`.

- **VM:** Debian 13 (Trixie), 8 vCPU / 32 GB / 185 GB, IP `10.200.200.131`
  (office LAN, behind NAT). SSH: `ssh gracie-vm` (key `~/.ssh/gracie_vm`, user
  `phoenix`, passwordless sudo). Timezone Eastern. UFW: 22 + 8000.
- **Coolify:** v4.1.2 standalone at `http://10.200.200.131:8000`. Admin
  `daniel@fnit.us`. API token issued (see SECRETS). Project **gracie**.
  - *Note:* main Coolify in Hetzner is NOT linked (office VM is NAT'd); this
    Coolify runs standalone. Revisit with Tailscale if remote management wanted.
- **Services (all in Coolify `gracie` project, internal Docker network):**
  - **Supabase** (`x94kt9hzbjzhplqbhedxi71x`) — 14 containers; Postgres 15 +
    pgvector; **GA App schema migrated** (24 tables, 31 enums, all RLS,
    `match_embeddings`, `auth_role`/`auth_uid`). Reached via Kong gateway
    `supabase-kong-x94kt9hzbjzhplqbhedxi71x:8000` on the internal network.
  - **Logto** (`p2bsq93ooxot6sj6ntmj93nt`) — app + its Postgres. App config +
    Microsoft connector + roles still TODO (needs admin-console access).
  - **MinIO** (`gfnts1k0evdk27m9imi2lt8h`, compose service) — buckets `ga-app`
    + `ga-app-dev`. Endpoint `minio-gfnts1k0evdk27m9imi2lt8h:9000` internal.
- **Access model:** services are internal-only; the GA app (to be deployed in
  Coolify) reaches them by container hostname. Public team access to Logto/app
  will use Cloudflare Tunnel later.

### Remaining infra TODO
- [ ] Deploy `apps/web` + `apps/worker` into Coolify (gracie project).
- [ ] Configure Logto application + Microsoft Entra connector + roles.
- [ ] Cloudflare Tunnel for team-facing access (app + Logto login).
- [ ] Redis + n8n (later phases).
- [ ] Create a scoped MinIO access key (replace root creds in app).
- [ ] Backups: Postgres dumps + MinIO sync off-site (Phase 10).

---

## 0. Prerequisites checklist

- [ ] Proxmox host access (2× Xeon E5-2660 v3, 128 GB RAM, Synology SAN).
- [ ] A domain (or subdomain) for the app, e.g. `ga.yourdomain.com`.
- [ ] Cloudflare account managing that domain's DNS (for Tunnel).
- [ ] Debian 12 (Bookworm) ISO available in Proxmox, or a cloud-init template.

---

## 1. Create the VM

In Proxmox:

| Setting | Value |
| --- | --- |
| OS | Debian 12 (Bookworm), 64-bit |
| vCPU | 8 (type: `host`) |
| RAM | 32 GB |
| Disk | 200 GB, `virtio-scsi`, **cache = Write back** |
| Network | `virtio`, bridged to your LAN/VLAN |
| QEMU guest agent | Enabled |

1. Create VM, attach Debian 12 ISO, install (minimal — no desktop).
2. Set a static IP (or DHCP reservation) on the host network.
3. Note the VM's IP → record as `VM_IP` in SECRETS.md.

After first boot:
```bash
apt update && apt -y upgrade
apt -y install curl git ufw fail2ban qemu-guest-agent
systemctl enable --now qemu-guest-agent
# Basic firewall: allow SSH on your LAN only; all public ingress comes via Cloudflare Tunnel
ufw default deny incoming
ufw default allow outgoing
ufw allow from <YOUR_LAN_CIDR> to any port 22 proto tcp
ufw enable
```

---

## 2. Install Docker + Coolify

```bash
# Docker
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker

# Coolify (one-line installer)
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
```

- Open Coolify at `http://<VM_IP>:8000`, create the admin account.
- Record Coolify admin creds → SECRETS.md.
- In Coolify: create a **Project** named `ga-app` with one **Environment** = `production`.

> Use context7 / Coolify docs for the current installer URL and any version notes
> before running, in case the install path changed.

---

## 3. Networking — Cloudflare Tunnel (no open ports)

Goal: public hostnames reach only `web` and the Logto console; everything else stays internal.

1. In Cloudflare Zero Trust → **Networks → Tunnels → Create tunnel** (`ga-app`).
2. Install the connector on the VM (Cloudflare gives a `cloudflared` docker/run command, or add as a Coolify service). Record the tunnel token → SECRETS.md.
3. Public hostnames (add as the services come up):
   - `ga.yourdomain.com` → `http://web:3000`
   - `auth.yourdomain.com` → Logto endpoint (`http://logto:3001`)
   - (Optional, lock behind Cloudflare Access) `n8n.yourdomain.com` → `http://n8n:5678`
4. **Do NOT** expose Postgres, MinIO, or Redis publicly — internal Docker network only.

---

## 4. Deploy services (in Coolify, all in project `ga-app`)

Deploy in this order. After each, record its credentials in SECRETS.md.

### 4.1 Redis
- Coolify → New Resource → **Redis**.
- Internal only. Record `REDIS_URL` (e.g. `redis://default:<pw>@redis:6379`).

### 4.2 Supabase (self-hosted stack)
- Coolify → New Resource → **Supabase** (one-click), or deploy the official
  `supabase/docker` compose as a Docker Compose resource.
- Set: `POSTGRES_PASSWORD`, `JWT_SECRET` (long random), dashboard user/pass.
- After boot, derive `SUPABASE_ANON_KEY` + `SUPABASE_SERVICE_ROLE_KEY` from the JWT secret
  (Supabase docs / the stack's key-gen step).
- Map the Postgres data volume to SAN-backed storage.
- Record: `SUPABASE_URL` (internal + tunnel), `SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `POSTGRES_PASSWORD`.
- Enable extensions (SQL editor): `create extension if not exists vector;` and `pgcrypto;`

### 4.3 MinIO (file storage)
- Coolify → New Resource → **MinIO**.
- Set root user/password. Create bucket `ga-app` (and `ga-app-dev`).
- Create a scoped access key (read/write on `ga-app`) for the app.
- Internal only. Record: `S3_ENDPOINT` (e.g. `http://minio:9000`),
  `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET=ga-app`,
  `S3_REGION=us-east-1`, `S3_FORCE_PATH_STYLE=true`.
- Map data volume to SAN-backed storage.

### 4.4 n8n + its Postgres
- Deploy a **separate Postgres** (Coolify resource) for n8n — do NOT share Supabase (D12).
- Deploy **n8n**, pointed at that Postgres. Set basic auth.
- Record n8n creds + `GA_API_TOKEN` (a token the app accepts from n8n later).

### 4.5 Logto (auth)
- Deploy **Logto** + its Postgres (Coolify).
- Expose the Logto endpoints via the tunnel (`auth.yourdomain.com`).
- In Logto admin: create the Next.js app, set redirect URIs
  (`https://ga.yourdomain.com/api/auth/callback`), add the **Microsoft/Entra** connector,
  define roles `admin`/`standard`/`viewer`.
- Record: `LOGTO_ENDPOINT`, `LOGTO_APP_ID`, `LOGTO_APP_SECRET`, `LOGTO_COOKIE_SECRET`.
- (Entra login app + Graph calendar app are configured per `docs/07` §5–6.)

### 4.6 web + worker (the app)
- Deploy from the `gracie` Git repo (two Coolify apps: `apps/web`, `apps/worker`), or
  build images. These come online in **Phase 1B** once integrations are wired.
- Set all env vars from SECRETS.md per service.

---

## 5. Environment variables (set in Coolify per service)

Use the consolidated list in `docs/07-integrations.md` §`.env.example`. Minimum for the
app to boot (Phase 1B):
```
SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_JWT_SECRET
APP_ENCRYPTION_KEY
LOGTO_ENDPOINT / LOGTO_APP_ID / LOGTO_APP_SECRET / LOGTO_COOKIE_SECRET
MS_TENANT_ID / MS_CLIENT_ID / MS_CLIENT_SECRET / MS_CALENDAR_GROUP_ID
S3_ENDPOINT / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY / S3_BUCKET / S3_REGION / S3_FORCE_PATH_STYLE
REDIS_URL
RECALL_API_KEY (+ webhook secret) / OPENAI_API_KEY / RESEND_API_KEY / RESEND_FROM
```

---

## 6. Verification (before declaring infra ready)

- [ ] Coolify reachable; all services show **healthy**.
- [ ] `ga.yourdomain.com` resolves via Cloudflare and reaches `web` (404/placeholder OK pre-1B).
- [ ] Supabase Studio reachable internally; `vector` + `pgcrypto` extensions enabled.
- [ ] MinIO console reachable internally; bucket `ga-app` exists; test put/get with the app key.
- [ ] Redis reachable from the worker only.
- [ ] Logto admin reachable via `auth.yourdomain.com`; Microsoft connector test login works.
- [ ] Postgres, MinIO, Redis are **NOT** publicly reachable (verify from outside the LAN).
- [ ] All credentials recorded in `docs/SECRETS.md`.

---

## 7. Backups (schedule now; harden in Phase 10)

- **Postgres (Supabase):** scheduled `pg_dump` (Coolify backups or cron) → encrypted → off-site.
- **MinIO `ga-app`:** scheduled sync → off-site target (R2 or offsite Synology) — D16.
- **n8n-postgres + Coolify config:** include in backup set.
- **Proxmox VM:** periodic VM-level snapshot/backup (covers the whole stack at once).

---

## 8. Handoff to Phase 1B

Once §6 verification passes and credentials are in SECRETS.md, the master terminal
dispatches **Phase 1B** (per `docs/09-build-phases.md` Phase 1 brief), which will:
1. Wire the self-hosted Supabase client + run the migration from `docs/04-database-schema.sql`.
2. Wire MinIO via the S3 client + presigned-URL flow.
3. Replace mock auth with real Logto SSO + middleware.

> Until then, the Phase 1A app runs fine on mock auth — infra readiness is the only blocker.
