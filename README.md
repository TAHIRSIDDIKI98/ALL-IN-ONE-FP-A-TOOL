# OneFP&A

Cloud FP&A platform with verified **M0 Foundation**, **M1 Spine**, and **M2 Planning Suite** capabilities, and **M3 xP&A + Intelligence** in progress (`TASKBOARD.md`).

## Current Verified Status

- **Milestone Scope**: **M3 xP&A + Intelligence** (in progress; opened under `DEC-022` — see `TASKBOARD.md` for live work-item verification evidence and pasted gate output).
- **Verified Capabilities (M0–M2 & M3 to Date)**:
  - **M1 Financial Spine**: Multi-format fiscal calendars (`12month`, NRF `445`/`454`/`544`/`52_53`/`13x4`), decimal-only money math, CSV/XLSX GL & budget imports with quarantine & row accounting (`rowsIn === importedCount + quarantinedCount`), versioned Chart of Accounts mapping, balanced Trial Balance with drill-to-source, articulating P&L / Balance Sheet / Indirect Cash Flow (`A1–A5`), Budget-vs-Actual variance, and audit-tied XLSX/PDF/PPTX Board Packs.
  - **M2 Planning, Collaboration & Controls**: Driver-based modeling (`fixed`, `growth_rate`, `percent_of_account`, `price_times_volume`), rolling forecasts, multi-scenario comparisons, RBAC approval workflow with `@mentions` & notifications, Workforce module compiled via the canonical planning engine, Flux waterfall & PVM bridges, 18-KPI Dashboard & cited Report Builder, 3 data-only industry packs (`saas`, `retail`, `manufacturing`), external connectors (`Google Sheets`, `QuickBooks Online`, `Xero`), M2 Coherent Corpus v2 multi-tenant verification, Partner Migration & Onboarding pipeline (`dry_run` / `stage_commit`), and contextual guidance / UTC temporal boundaries / `en-US` + `ar-SA` RTL + `pseudo` localization (`WI-0043`).
  - **M3 xP&A + Intelligence (Verified Increments)**:
    - Close Management & Period Locks (`WI-0045`, `CLS1–CLS4`: DAG checklist, live reconciliation gate, soft/hard period locks, owner audited unlock).
    - Exception-Rule Catalog, Owner Inbox & Reversal-Only Rectification (`WI-0046`, 28 rules `EXC-001`..`EXC-028`, `<=90d` waivers, single-path GL reversals).
    - Multi-Entity, Multi-Currency & Consolidation/Eliminations (`WI-0047`, `FX1–FX5`: sourced FX translation, computed CTA `A7`, realized/unrealized revaluation, IC elimination & residual quarantine, NCI tie-out).
    - Two-Tier Planner / Executor Governance (`WI-0047A`, `DEC-025`, `ADR-0004`: `MASTER_PROMPT.md` v1.4 Part 14 + `SPEC.md` Section 7 execution blueprints for **Gemini Neon** planning and **Gemini 3.5 Flash-Lite** bounded execution).
- **In-Progress / Deferred / CI-Gated Boundaries**:
  - **Remaining M3 & M4–M6 Roadmap**: Cited AI commentary/NLQ/formula builder (`WI-0048A/B/C`, blueprinted in `SPEC.md §7.3` and queued next), CapEx/Sales/Treasury modules, NetSuite/D365 connectors, Monte Carlo simulation, marketplace, and enterprise SSO/SOC 2 report are not yet verified.
  - **CI-Gated Legs (`Q-004`, `Q-006`)**: Production PostgreSQL driver (`DATABASE_URL`), Firebase Authentication credentials, and full Chromium Playwright execution run in CI rather than the offline sandbox.

## Verification

Run all 16 local sandbox gates (`< 60s`, zero external credentials):

```bash
npm run verify
```

Regenerate or drift-check end-user docs derived from `SPEC.md`:

```bash
node scripts/generate-docs.mjs --check
```

## Documentation & Governance

- `MASTER_PROMPT.md` (v1.4) — Constitutional rules, stack, schema, engine contracts, milestone gates, Work-Integrity Codex (Part 13), and Two-Tier Planner/Executor Protocol (Part 14).
- `SPEC.md` — Living specification across M0–M3 plus Section 7 Low-Level AI Conventions & Active Execution Blueprints (`WI-0048A/B/C`).
- `TASKBOARD.md` — Single ledger of work items, gate runs, decisions (`DEC-001`–`DEC-025`), salvage ports, attestations, and session handovers.
- `docs/adr/` — Immutable Architecture Decision Records (`ADR-0001`–`ADR-0004`).
- `docs/user-guide/README.md` — Generated end-user guide derived deterministically from `SPEC.md` (`DOC2`).
- `docs/m1-gate-review.md` & `docs/m2-gate-review.md` — Gate-by-gate evidence reviews for M1 and M2.
