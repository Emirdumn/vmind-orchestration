# VMind Agentic Operations Hub

This folder is the Cursor-ready working context for the VMind Agentic Operations Hub idea.

Start here:

1. `00-overview.md` - product framing and layer model.
2. `01-orbina-vmind-analysis.md` - Orbina inspiration and VMind opportunity.
3. `02-rag-agent-architecture.md` - RAG, agents, tool/API architecture.
4. `03-data-permissions.md` - data sources, RBAC, KVKK-oriented guardrails.
5. `04-mvp-roadmap.md` - 30-day MVP backlog and demo scenarios.
6. `05-bot-guardrails-eval.md` - bot behavior rules and evaluation set.
7. `06-cursor-start-here.md` - paste-ready Cursor prompt for continuing implementation.

Core product sentence:

> VMind Agentic Operations Hub turns VMind's cloud, ticket, ERP/VRP, and finance knowledge into one secure AI operations layer that answers with sources, reads systems through approved tools, drafts actions, and hands off risky cases to the right human team.

Current implementation stance:

- Build RAG first; do not fine-tune in the MVP.
- Use anonymized SMAX exports before live ticket integration.
- Keep Logo and PortvMind integrations read-only until approval and audit gates exist.
- Treat write actions as drafts unless explicitly approved by an authorized user.
- Every answer should be source-grounded or clearly refuse to guess.

