# 10 — Cost Analysis (Self-Hosted vs Cloud)

> For the monthly cost model and client billing. Shows what self-hosting on the
> Proxmox VM saves versus cloud-hosting, plus the unavoidable external SaaS costs.
>
> ⚠️ **Estimates, not quotes.** 2026 list prices, planning-grade. Confirm live
> pricing (especially Recall.ai + OpenAI usage) before committing client numbers.

---

## Summary

| Bucket | Monthly (est.) |
| --- | --- |
| **A. Self-hosted services** — cloud equivalent you AVOID | **~$150–300** (up to $500+ on premium clouds) |
| **B. External SaaS** — unavoidable either way | **~$130–590** (mostly Recall + OpenAI usage) |
| **C. Your infra allocation** — power/SAN wear/Proxmox capacity | internal figure (low marginal cost) |

**The self-hosting savings story:** ~**$150–300/month** that would otherwise go to
managed cloud services, delivered on owned hardware at low marginal cost.

---

## A. Self-hosted → cloud equivalents (your savings)

These run on the Proxmox VM. The right column is what you'd pay monthly if cloud-hosted.

| Service (self-hosted) | Cloud equivalent | Est. cloud cost/mo |
| --- | --- | --- |
| Compute (VM: 8 vCPU/32 GB) | Hetzner CPX41 (~€30) → AWS/DO equiv | $30–160 |
| Postgres + pgvector | Supabase Pro / managed Postgres | $25–100 |
| Object storage (files) | Cloudflare R2 / S3 (modest TB) | $15–60 |
| Auth (Logto) | Logto Cloud / Auth0 | $0–240 (Auth0 scales badly) |
| Redis | Upstash / Redis Cloud | $10–50 |
| n8n | n8n Cloud | $20–50 |
| **Subtotal avoided** | | **~$100–660/mo** |

Realistic mid-tier midpoint: **~$150–300/mo saved.** Premium clouds (AWS + Auth0) push past $500.

---

## B. External SaaS — unavoidable (cannot be self-hosted)

You pay these whether cloud or self-hosted. Needed for the client cost model.

| Service | Cost driver | Est. cost/mo |
| --- | --- | --- |
| **Recall.ai** ⚠️ | Per-meeting bot + recording hours | **$100–400+** — often the largest line |
| **OpenAI API** | 6 docs × meetings + chat + embeddings | **$30–150** (scales with meeting volume) |
| **Resend** | Email volume (low) | $0–20 |
| **Microsoft Graph** | Included in existing M365 licenses | $0 extra |
| **Domain / Cloudflare** | DNS + Tunnel | $0–20 |
| **Subtotal** | | **~$130–590/mo** |

> ⚠️ **Recall.ai is the variable to watch** — usage-priced per meeting/recording hour,
> frequently the single biggest recurring cost. Confirm current plan pricing.

---

## C. Your true cost (self-hosted reality)

| Line | Monthly |
| --- | --- |
| External SaaS (B) | ~$130–590 (mostly Recall + OpenAI) |
| Infra allocation (power, SAN wear, Proxmox capacity) | internal — low marginal cost |
| Cloud spend AVOIDED (A) | **~$150–300+ saved** |

---

## Client billing model (suggested structure)

Present three separate lines to the client:

1. **Hosting / infrastructure fee** — for using the web-company Proxmox/SAN resources.
   Anchor to the **cloud-equivalent (~$150–300/mo)** you displace. You can charge at or
   below cloud rates and retain margin since marginal cost is low.
   *Framing:* "Cloud-hosted this is ~$X/mo; provided on owned infrastructure for $Y."
2. **Pass-through SaaS** — OpenAI + Recall (usage-based). Pass through at cost or with a
   margin. **Flag Recall as the variable line item.**
3. **IT / development service fee** — your time, separate line.

### Recommendation
Track **actual OpenAI + Recall usage** during build/pilot so the client number is grounded
in real data, not estimates. The app already records `pipeline_runs` + token usage via the
AI provider interface — add lightweight usage reporting (Phase 9/10) to make this trivial.

---

## Notes / assumptions

- 8 users, ~30 clients, dozens of meetings/month — small scale; cloud "free tiers" would
  cover some of this initially, but managed costs climb with data + retention.
- Self-hosting trades **recurring cloud fees** for **owned ops** (backups, patching,
  monitoring) — acceptable here given the hardware is already paid for and underutilized
  (~8% CPU, ~61 GB RAM free).
- Compliance/data-residency value (client data on owned infra) is a qualitative benefit
  not captured in the dollar figures but central to the decision (D15).
