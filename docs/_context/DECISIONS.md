# GA App — Locked Decisions

> Every architectural decision the user has confirmed.
> Append-only. **Never re-litigate a locked decision** — if the user revisits one, supersede it explicitly with a new entry and mark the old one `SUPERSEDED`.

Format per entry:
```
## [NNN] <topic>
Date: YYYY-MM-DD
Question:  <the question that was being decided>
Choice:    <what was picked>
Rationale: <one or two lines>
Affects:   <which subsystems / plans this constrains>
```

---

## [001] Repo location & visibility
Date: 2026-05-23
Question: Where does the repo live and what visibility?
Choice: `github.com/RelentNet/gracie`, public, under the RelentNet org.
Rationale: User confirmed RelentNet org. Public for transparency; no secrets in repo.
Affects: All infra; CI/CD will run on public repo.

## [002] Backend structure
Date: 2026-05-23
Question: Where does the API/pipeline code live?
Choice: **Separate Fastify backend service**, deployed as its own container on Coolify alongside Next.js.
Rationale: Pipeline jobs run 60+ seconds (6 Claude calls per meeting); incompatible with serverless-style Next.js route limits. Clean FE/BE separation. Fastify is fast, mature, and TypeScript-friendly.
Affects: Repo layout (monorepo with `apps/web` + `apps/api`), deploy (two containers), all backend plans.

## [003] Job queue
Date: 2026-05-23
Question: How are background jobs / pipeline runs scheduled and processed?
Choice: **BullMQ + Redis**, Redis container on Coolify.
Rationale: Industry-standard, mature, great observability via Bull Board, native support for retries/delays/cron/concurrency. Pairs cleanly with a separate Fastify backend.
Affects: All pipeline plans, calendar scan cron, daily sync cron, doc generation parallelism.

## [004] Backend language
Date: 2026-05-23
Question: What language is the backend written in?
Choice: **Node.js / TypeScript** everywhere (frontend and backend).
Rationale: Single language across the stack; shared types via a `packages/shared` workspace; full team velocity; Recall.ai delivers transcript text so audio processing isn't urgent.
Affects: Repo layout, dependency choices, monorepo tooling (pnpm + turbo or bun workspaces).

## [005] Cross-session context model
Date: 2026-05-23
Question: How do we preserve project context across short Claude Code sessions?
Choice: **`docs/_context/` directory** with STATE.md / DECISIONS.md / STACK.md / GLOSSARY.md, plus root **AGENTS.md** that points future sessions at those files first.
Rationale: Versioned in the repo, role-per-file (easy to update STATE without churning DECISIONS), auto-loads via AGENTS.md.
Affects: Workflow only — every session updates STATE.md before ending.

## [006] Specs reconciliation policy
Date: 2026-05-23
Question: When the v1 backend spec and the Figma frontend spec disagree, which wins?
Choice: **v1 backend spec wins** on backend / data / pipeline / integrations. **Figma wins** on design system / typography / color / component anatomy. Where both touch the same surface, merge.
Rationale: v1 is the more recently deliberated spec for system architecture; Figma is the more recently deliberated spec for visual/UX.
Affects: All plans. Figma-only features get flagged for phase decisions.
