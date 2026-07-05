# Cursor Start Here

Use this prompt in Cursor to continue from the current product/design state.

```text
We are building VMind Agentic Operations Hub.

Before coding, read:
- docs/vmind-agentic-operations-hub/README.md
- docs/vmind-agentic-operations-hub/00-overview.md
- docs/vmind-agentic-operations-hub/02-rag-agent-architecture.md
- docs/vmind-agentic-operations-hub/03-data-permissions.md
- docs/vmind-agentic-operations-hub/04-mvp-roadmap.md
- docs/vmind-agentic-operations-hub/05-bot-guardrails-eval.md

Goal for the first implementation pass:
Create a usable MVP prototype in this existing Vite/React/Shadcn project for an internal VMind AI operations assistant.

The first screen should be the actual product interface, not a marketing landing page.

Build:
- Left navigation for data sources: Knowledge Base (primary), Runbooks, vRPMind, PortvMind, Logo, SMAX (signal only).
- Main chat/workbench area for asking operational questions.
- Source-grounded answer panel with citations.
- SMAX ticket-signal cards for problem trend and KB backlog prioritization.
- Permission/safety status panel showing role, data class, and action mode.
- MVP roadmap or evaluation tab if useful.

Keep write actions as drafts. Do not implement destructive operations. Use mock data first, but structure the code so real connectors can be added later. Do not generate solutions directly from ticket text; answers should come from Problem KB/runbooks/procedures.

Design tone:
Quiet, operational, dense but readable. This is a work tool for cloud/network/finance/sales operations, not a hero landing page.
```

## First Cursor tasks

1. Inspect the existing React routes and components.
2. Decide whether to replace the current first screen or add a new route.
3. Add mock data for sources, citations, Problem KB articles, ticket signals, and agent decisions.
4. Build the workbench UI.
5. Add tests for retrieval/permission helper functions if helpers are introduced.
