# OneFP&A

Cloud FP&A platform with verified **M0 Foundation**, **M1 Spine**, and **M2 Planning Suite** capabilities (`TASKBOARD.md`).

## Current Verified Status

- **Milestone Scope**: **M2** Planning Suite (see `TASKBOARD.md` for live work-item verification evidence and pasted gate output).
- **Verified Capabilities (M0–M2)**:
  - **M1 Financial Spine**: Multi-format fiscal calendars (`12month`, NRF `445`/`454`/`544`/`52_53`/`13x4`), decimal-only money math, CSV/XLSX GL & budget imports with quarantine & row accounting (`rowsIn === importedCount + quarantinedCount`), versioned Chart of Accounts mapping, balanced Trial Balance with drill-to-source, articulating P&L / Balance Sheet / Indirect Cash Flow (`A1–A5`), Budget-vs-Actual variance, and audit-tied XLSX/PDF/PPTX Board Packs.
  - **M2 Planning, Collaboration & Controls**: Driver-based modeling (`fixed`, `growth_rate`, `percent_of_account`, `price_times_volume`), rolling forecasts, multi-scenario comparisons, RBAC approval workflow with `@mentions` & notifications, Workforce module compiled via the canonical planning engine, Flux waterfall & PVM bridges, 18-KPI Dashboard & cited Report Builder, 3 data-only industry packs (`saas`, `retail`, `manufacturing`), external connectors (`Google Sheets`, `QuickBooks Online`, `Xero`), M2 Coherent Corpus v2 multi-tenant verification, Partner Migration & Onboarding pipeline (`dry_run` / `stage_commit`), and contextual guidance / UTC temporal boundaries / `en-US` + `ar-SA` RTL + `pseudo` localization (`WI-0043`).
- **Deferred / CI-Gated Boundaries**:
  - **M3–M6 Roadmap**: Items in `MASTER_PROMPT.md §2.6` (period close/lock, multi-entity consolidation, Monte Carlo simulation, marketplace, AI copilots, SSO) are outside the M2 cut line and intentionally not built here.
  - **CI-Gated Legs (`Q-004`)**: Production PostgreSQL driver (`DATABASE_URL`), Firebase Authentication credentials, and full Chromium Playwright execution run in CI rather than the offline sandbox.

## Verification

Run all local sandbox gates with zero external credentials:

```bash
npm run verify
```

Regenerate or drift-check end-user docs derived from `SPEC.md`:

```bash
node scripts/generate-docs.mjs --check
```

## Documentation & Governance

- `docs/user-guide/README.md` — Generated end-user guide derived deterministically from `SPEC.md` (`DOC2`).
- `docs/m1-gate-review.md` & `docs/m2-gate-review.md` — Gate-by-gate evidence reviews for M1 and M2.
- `MASTER_PROMPT.md` — Constitutional rules, stack, schema, engine contracts, and milestone gates.
- `SPEC.md` — Living specification across M0–M2 milestones.
- `TASKBOARD.md` — Single ledger of work items, gate runs, decisions, salvage ports, and session handovers.
