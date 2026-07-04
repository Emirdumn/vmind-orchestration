---
description: "VMind Agentic Operations Hub product context and implementation guardrails"
globs:
alwaysApply: true
---

# VMind Agentic Operations Hub Rule

When working in this repository, treat `docs/vmind-agentic-operations-hub/` as the active product context.

Read these docs before substantial product or architecture changes:

- `docs/vmind-agentic-operations-hub/README.md`
- `docs/vmind-agentic-operations-hub/00-overview.md`
- `docs/vmind-agentic-operations-hub/02-rag-agent-architecture.md`
- `docs/vmind-agentic-operations-hub/03-data-permissions.md`
- `docs/vmind-agentic-operations-hub/04-mvp-roadmap.md`
- `docs/vmind-agentic-operations-hub/05-bot-guardrails-eval.md`

Product principles:

- This is an internal operations assistant, not a generic chatbot.
- The MVP is RAG-first; do not assume fine-tuning is needed.
- Every answer should be source-grounded or explicitly say the source is missing.
- SMAX ticket data must be anonymized before indexing.
- Logo, PortvMind, and other sensitive integrations should start as read-only.
- Write operations must be drafts until approval, RBAC, and audit gates exist.
- UI should feel like a focused operations console: compact, legible, and action-oriented.

