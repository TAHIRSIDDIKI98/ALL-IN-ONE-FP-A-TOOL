# OneFP&A

Cloud FP&A platform under active **M0 Foundation** construction.

## Current Verified Status

- **Milestone**: M0 Foundation (in progress — see `TASKBOARD.md` for live work-item verification status and pasted gate output).
- **Spine Scope (M0–M1)**: Single-company month-end spine (CSV/XLSX GL & budget import, versioned Chart of Accounts mapping with quarantine, balanced Trial Balance, articulating P&L / Balance Sheet / Indirect Cash Flow, Budget-vs-Actual variance, drill-to-source, and XLSX/PDF board pack).
- **Not Yet Shipped**: M1 spine end-to-end workflow and M2–M6 roadmap items (listed in `MASTER_PROMPT.md §2.6`) are not yet complete; no feature is claimed complete without pasted gate evidence in `TASKBOARD.md`.

## Verification

Run all sandbox gates locally with zero external credentials:

```bash
npm run verify
```

## Governance & Architecture

- `MASTER_PROMPT.md` — Constitutional rules, stack, schema, engine contracts, and milestone gates.
- `SPEC.md` — Living specification for current (M0) and next (M1) milestones.
- `TASKBOARD.md` — Single ledger of work items, gate runs, decisions, salvage ports, and session handovers.
