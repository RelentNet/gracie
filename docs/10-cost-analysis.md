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

## Current tooling spend vs GA App (the headline)

### What GA's team pays today (the tools GA App replaces or overlaps)

| Tool | Detail | Monthly | Annual |
| --- | --- | --- | --- |
| **Otter.ai** | 14 seats (10 idle), Business annual | ~$210–224 | ~$2,520–2,690 |
| **ChatGPT Business Premium** | 9 users × $20 | **$180** | **$2,160** |
| **Current total** | | **~$390–404** | **~$4,680–4,850** |

### What GA App costs to run (self-hosted, all-in)

| Line item | Monthly | Notes |
| --- | --- | --- |
| Recall.ai (transcription) | ~$42–84 | ~84 hrs/mo usage-based — replaces Otter |
| OpenAI API (doc gen + embeddings + chat) | ~$30–150 | scales with meeting volume |
| Resend (email) | ~$0–20 | low volume |
| Microsoft Graph (calendar) | $0 | included in M365 |
| Domain / Cloudflare | ~$0–20 | DNS + Tunnel |
| Infrastructure (Proxmox VM + SAN) | ~$0 marginal | owned hardware, ~8% utilized |
| **GA App total** | **~$72–274** | midpoint **~$170/mo** |

### Side-by-side

| | Monthly | Annual |
| --- | --- | --- |
| **Current tools (Otter + ChatGPT)** | ~$390–404 | ~$4,680–4,850 |
| **GA App (self-hosted, all-in)** | **~$170** | **~$2,040** |
| **Vs. cloud-hosted GA App** | ~$385 | ~$4,620 |

### The story

- **GA App self-hosted (~$170/mo) costs LESS than Otter alone today (~$210–224/mo)** — and
  delivers the entire platform (transcription + AI docs + tasks + calendar + daily sync).
- **Vs. current combined tooling (~$390–404/mo), GA App is ~$220/mo (~$2,640/yr) cheaper.**
- **Self-hosting vs cloud-hosting GA App** saves a further ~$215/mo (~$2,580/yr).

### ChatGPT seats — partial displacement (conservative)

GA App uses the **same OpenAI models** your team accesses via ChatGPT Business. It absorbs
**task-specific** AI work (meeting summaries, follow-up drafts, client-scoped Q&A). It does
**not** replace **general-purpose** ChatGPT use (ad-hoc writing/research/brainstorming).

- **Conservative:** keep ChatGPT seats; GA App reduces manual effort, not the seat count.
- **Likely:** some users who only used ChatGPT for meeting/client tasks can drop their seat,
  or the line stops growing. Even dropping **4–5 seats = ~$80–100/mo (~$960–1,200/yr)** more
  saved. Validate per-user after GA App is live before cutting seats.

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
| **Recall.ai** | Per recording hour (~84 hrs/mo actual) | **~$42–84/mo** — see Otter→Recall section; cheaper than current Otter |
| **OpenAI API** | 6 docs × meetings + chat + embeddings | **$30–150** (scales with meeting volume) |
| **Resend** | Email volume (low) | $0–20 |
| **Microsoft Graph** | Included in existing M365 licenses | $0 extra |
| **Domain / Cloudflare** | DNS + Tunnel | $0–20 |
| **Subtotal** | | **~$130–590/mo** |

> ✅ **Recall.ai is cheaper than current Otter for GA's actual usage** (~84 hrs/mo,
> concentrated in one user; 10 of 14 Otter seats idle). See the Otter→Recall section
> below. Still confirm Recall's per-hour rate + any monthly minimum.

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

## Otter.ai → Recall.ai comparison (from real usage data)

> Source: `Otter-Teams-Usage` export (June 2026). Replaces the per-seat Otter
> transcription cost with Recall.ai's usage-based model.

### Actual Otter usage (14 seats provisioned)

| User | Avg min/month | Hours/mo |
| --- | --- | --- |
| Cynthia Wallace | 4,623 | ~77.0 |
| Surafeal Asgedom | 229 | ~3.8 |
| Allie Grace | 105 | ~1.75 |
| Scott Svabek | 92 | ~1.5 |
| **Other 10 seats** | **0** | **0** |
| **Team total** | **~5,048 min** | **~84 hrs/mo** |

**Key findings:**
- **10 of 14 seats are completely idle** — paying per-seat for non-users.
- **One user (Cynthia) drives ~92%** of all transcription.
- Per-seat pricing is a poor fit for this concentrated, low-volume pattern.

### Cost comparison

**Otter (current, per-seat):**

| | Estimate |
| --- | --- |
| 14 seats × ~$15–16/seat/mo (annual rate) | **~$210–224/mo** (~$2,520–2,690/yr) |
| Idle-seat waste (10/14 unused) | **~71% of spend** |

> Use your **actual annual invoice ÷ 12** for the true figure.

**Recall.ai (usage-based, ~84 hrs/mo):**

| Rate | Monthly | Annual |
| --- | --- | --- |
| @ $0.50/hr | ~$42 | ~$504 |
| @ $0.75/hr | ~$63 | ~$756 |
| @ $1.00/hr | ~$84 | ~$1,008 |

### Result

**Recall is materially cheaper for this usage profile: ~$63/mo vs ~$210–224/mo —
roughly $150/mo (~$1,800/yr) saved.** Usage-based billing ignores the 10 idle seats
entirely. This *inverts* the earlier "Recall may be the biggest cost" caution — that
risk only applies to heavy-recording teams; GA's actual volume is low and concentrated.

⚠️ **Confirm before quoting:**
1. Recall.ai's **actual per-hour rate + any monthly base/minimum fee** (a minimum could
   raise the effective cost at this low volume).
2. **Volume may rise** if GA App records *every* client meeting automatically (vs today's
   selective use). Usage would need to ~3× before approaching Otter's flat fee.

---

## Notes / assumptions

- **14 Otter seats** (~4 active) + **9 ChatGPT Business seats ($180/mo)**, ~30 clients,
  ~84 recorded meeting-hours/month — small scale; cloud "free tiers" would cover some of
  this initially, but managed costs climb with data + retention. Headcount does not change
  infra sizing (still trivial load on the Proxmox VM).
- ChatGPT-seat displacement is **conservative and unverified** — confirm per-user after
  launch before cutting seats; some general-purpose ChatGPT use is legitimate and stays.
- Self-hosting trades **recurring cloud fees** for **owned ops** (backups, patching,
  monitoring) — acceptable here given the hardware is already paid for and underutilized
  (~8% CPU, ~61 GB RAM free).
- Compliance/data-residency value (client data on owned infra) is a qualitative benefit
  not captured in the dollar figures but central to the decision (D15).
