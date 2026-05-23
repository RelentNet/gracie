# `docs/_context/`

Cross-session memory for Claude Code working on GA App.

| File | Purpose | Update frequency |
|------|---------|------------------|
| `STATE.md` | Live status, last session, next action, open questions | **Every session** |
| `DECISIONS.md` | Append-only log of locked architectural decisions | When the user confirms a decision |
| `STACK.md` | Resolved tech stack with status (✅ / 🟡 / ❓) | When a stack item moves status |
| `GLOSSARY.md` | Project terms | When a new project-specific term appears |

**Entry point for any new session:** read `STATE.md` first. Everything else is reference.

The two source-of-truth specs live in `../specs/`:
- `../specs/v1-backend.md` — canonical for backend / data / pipeline / integrations
- `../specs/figma-frontend.md` — canonical for design system / UI / component anatomy
