# FP&A platform — documentation-first master plan

**Status:** Draft v0.5 · **Date:** 18 November 2026 · **Owner:** User / solo builder · **Scope:** UAE, single-user, multi-business pilot, native 64-bit Office 2021 add-in and consolidation required · **Approval:** Legal perimeter, technical and finance details pending · **Implementation:** Not started

This is a decision-ready baseline, not a claim that every industry, regulation, or Excel feature is already supported. The product vision is broad; releases are narrow, verified, and honestly described.

## Read in order
1. `AGENTS.md` — mandatory rules for coding agents.
2. `docs/01-product-scope.md` — vision, personas, V1 boundaries, capability map.
3. `docs/02-architecture.md` — five-language roles, storage, IPC and recovery.
4. `docs/03-finance-engine.md` — formula and accounting semantics; worked test case.
5. `docs/04-offline-security.md` — offline contract, encryption, audit and threats.
6. `docs/05-roadmap.md` — releases, gates, estimates and risks.
7. `docs/06-agent-system.md` — documentation, task contracts, prompts and reviews.
8. `docs/07-quality-operations.md` — tests, benchmarks, Windows release and support.
9. `docs/08-integrations.md` — Excel, industry packs, sync and local AI.
10. `docs/09-decisions-research.md` — decisions, owner questions and sources.
11. `docs/10-first-sprint.md` — first tasks and acceptance criteria.
12. `docs/11-uae-excel-v1.md` — detailed UAE and native Excel product contract.
13. `docs/12-feedback-adjudication.md` — critical evaluation of all three AI reviews.
14. `docs/13-agent-control-system.md` — operating playbook, reference oracle and initial test matrix.
15. `docs/14-al-ghurair-group-pilot.md` — verified portfolio, business coverage and identity caveat.
16. `docs/15-portfolio-implementation-and-uats.md` — multi-business data model, pilot slice and tests.
17. `docs/16-readiness-gap-audit.md` — prioritized missing decisions, blockers and evidence to close.
18. `docs/17-discovery-and-pilot-charter.md` — senior interview, coverage worksheet and pilot sign-off.
19. `docs/18-engineering-and-finance-decisions.md` — unresolved finance, Excel, lifecycle and technical contracts.
20. `requirements/registry.csv` — starter requirement register; no tests falsely marked passed.
21. `fixtures/synthetic/` — fictional portfolio example, not corporate data.
22. `docs/templates/` — ready-to-use task and ADR templates.
23. `docs/19-consolidation-scope.md` — mandatory consolidation scope and synthetic example.
24. `../_project_brain/` — six-file project memory and agent rules; read Brain files 00 and 04 before every task.
25. `skills/README.md` — broad skill coverage, 18 local draft skills, candidate sources and security-gated quarantine.
26. `docs/20-tech-stack-brainstorm.md` — architecture alternatives; owner selection pending.
27. `decisions/ADR-001-v1-lean-local-core.md` — unapproved external AI stack recommendation, retained for review.
28. `tests/specifications/S-02-native-excel-xll.md` and `tests/specifications/S-03-finance-consolidation.md` — unapproved draft test specifications, not executed.
29. `prompts/frontend-builder-react-vite-tailwind.md` — initial prompt for an independently built UI-only synthetic prototype; `prompts/frontend-builder-addon-unlimited-tokens.md` — supplementary instructions for deep implementation and honest verification.
30. `docs/21-master-architecture-v2.2.md` — **Owner-approved Master Architectural & Implementation Specification v2.2** (10-industry packs, 5 contract-bounded languages with Rust fallback toggles, 100M+ cell Block-Hybrid target, 4-repo forensic countermeasures, `I01`–`I32` invariants, and native Windows 11 boundaries).
31. `docs/22-master-roadmap-and-erp-blueprint-v3.0.md` — **Owner-approved Master Roadmap & Universal ERP Blueprint v3.0** (Top-12 Universal ERP Adapter Catalog `I33`, Complete One-Stop FP&A Replacement Engines `I34`/`I35`, 8 Gated Vertical Build Phases `P0`–`P7` `I36`).
32. `docs/23-per-project-master-blueprint-v4.0.md` — **Owner-approved Per-Project Master Architecture & Multi-Project FP&A Blueprint v4.0** (7 Engineering Sub-Project Packs, Isolated Multi-Project Workspaces & Project P&L `I37`–`I39`, 0-orphan traceability `I40`, and `atlas-fpa-v4.0-parity-vectors.json`).
33. `projects/README.md` — **Modular Per-Project Blueprint Packs Index** (`PRJ-CORE`, `PRJ-IO`, `PRJ-FLOW`, `PRJ-DOCS`, `PRJ-XLL`, `PRJ-UI`, `PRJ-DIST`, and `FPA-WORKSPACES`).

## Authority and baseline recommendation
Accepted security/finance invariants > approved specs and ADRs > approved release scope > task contract > implementation. If documents conflict or decisions are missing, stop and ask. Current documents are **proposals**, not approval.

Start with **UAE, one person, one Windows device and a multi-business/multi-entity monthly pilot**, plus a native 64-bit Excel add-in as a V1 release gate. Both public websites are in scope per the user; precise legal reporting boundaries and consolidation policies require finance approval; see documents 14–15 and 19. Deliver offline project creation, import, mapping, basic P&L/BS/CF, editable assumptions, scenarios, variance reports, backup/restore and audit. Strong multi-user segregation needs trusted infrastructure or additional operational controls, not just local UI rules.

Included: a proposed V1, long-term product map, architecture and controls, AI-agent governance, milestones, tests and research. Not included: production code, verified benchmarks, legal/accounting certification, completed compliance assessment or functioning add-in. The user confirmed UAE, solo use, Excel V1 with 64-bit Excel, a Windows test machine, and a senior tester at Al Ghurair Group; precise legal consolidation perimeter, Excel edition/build and other decisions remain open.
