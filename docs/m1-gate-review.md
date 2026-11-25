# M1 Spine Gate Review — G1–G10

Date: 2026-11-25 (UTC)
Scope: MASTER_PROMPT v1.3, Part 2 §2.2 / §2.3; M1 work items WI-0012 … WI-0028.
Verdict: **G1–G10 GREEN**. The M1 cut line may be opened only by the owner; this review does not start M2 work.

## Evidence baseline

- All planned M1 work items are `VERIFIED` in `TASKBOARD.md`; the last two were WI-0027 (board-pack tie-out) and WI-0028 (versioned `coa_mapping`).
- Final local sandbox run after WI-0028: `VERIFY GREEN: 16/16 gates passed in 54503ms (<60000ms budget, 0 secrets)`.
- Work-integrity ratchet: `25` test files, `165` tests, `1239` assertions, `0` suppressions, `0` placeholders.
- Owner merge gate: PR #3 merged into `main` at `bb52242e7f93f064e81ea79a1cc9ac9cc5861513`; final PR head `adbbaf62093473b143d1a9a6fd4aa6626fe93a9e`.
- Final CI on that exact head: GitHub Actions run `45672240494`, job `139410318878` — **success**, including `Run sandbox verification suite` and `Run Playwright Spine Harness`. The earlier false green (`45656979206`) was corrected by full-history checkout, `pipefail`, the synthetic-merge exemption, and moving CI logs outside the repository root; no gate threshold was changed.

## Gate-by-gate finding

| Gate | Requirement (§2.2) | Finding | Primary evidence |
|---|---|---|---|
| **G1 — IMPORT** | Every row accounted; re-import atomic/idempotent, zero duplicates | **GREEN** | `core/import/import.test.ts` (4 tests) checks exact `imported + quarantined == rows_in` against the committed messy-export manifests; `server/db/repositories/import.test.ts` (6 tests) proves idempotent replacement keyed on `source_hash`; `server/server.test.ts` (20 tests) covers preview==commit, quarantine reasons, chart codes and the new versioned source mappings. Live smoke: `11 in / 0 posted / 11 quarantined` with named reasons before a chart, then `2/2/0` after it; WI-0028 live smoke: `0/3` before a mapping and `2/0` after, replay wrote `written 0 / unchanged 1`. |
| **G2 — TB** | Debits = credits to the cent; per-entry balance; nothing dropped | **GREEN** | `buildTrialBalance` over active batches only; independent BigInt oracle `20237811.00` on both sides; unbalanced journal refs quarantined whole; database deferred trigger re-proves balance at COMMIT; HTTP smoke `750.25 / 750.25` and `700.00 / 700.00`. |
| **G3 — ARTICULATION** | P&L→TB, A=L+E, CF cash=BS cash, NI→RE | **GREEN** | `core/statements/statements.test.ts` (9 tests) ties P&L, BS, indirect CF and retained-earnings roll-forward field-by-field to `fixtures/oracles`; checks A1–A5 for every period P01…P12. Live smoke: `Revenue=500.00`, `Net income=500.00`, `Total assets=500.00`, `Ending cash=500.00`, `articulation true`. |
| **G4 — BUDGET** | Budget lines stored, versioned, editable via import | **GREEN** | `core/budget/budget.test.ts` (6 tests) validates all-or-nothing CSV with row-numbered reasons; `server/db/repositories/budget.ts` writes `scenario → plan_version → plan_line`, creates a new version on re-import and flips `is_current` in one transaction; `POST /budget/import` (v1 → v2, 9 lines, total `56300.00`) and `GET /budget?year=` are live-smoked. `kind:'budget'` is refused by the GL path, so plan data can never enter actuals. |
| **G5 — BVA** | Variance amount/% per account, ties to statements, zero-base rules | **GREEN** | `core/variance/variance.test.ts` (6 tests) covers `0 vs 0`, `x vs 0 → n/m`, negative plan, favorability and exact PVM sum; `GET /bva?period=` joins the current plan version to the trial balance. Live smoke: revenue `750.25` vs plan `38000.00` = `-37249.75` (`-98.03%`, unfavorable); `byType.revenue.actual == statements.pnl.revenue == 750.25`; unplanned actuals reported separately. |
| **G6 — DRILL** | Every displayed number resolves to source rows | **GREEN** | `server/db/repositories/reports.test.ts` (8 tests) proves each posting carries `sourceFilename`, `sourceHash`, `rowNo`, period, date and verbatim `rawCells`, and that drill lines sum back to the trial-balance row. The Model Grid renders the server drill and prints `#DRILL` rather than an invented number if the sum disagrees. |
| **G7 — EXPORT TIE-OUT** | Engine == UI == XLSX == PDF, automated | **GREEN** | `server/export/boardPack.test.ts` (3 tests) parses the ACTUAL XLSX workbook and decodes the ACTUAL PDF content streams, comparing every row's `label`, `value` and `detail` to the canonical JSON; one canonical `rows[]` feeds the browser preview and both renderers. Live smoke: XLSX `11539 bytes`, PDF `59411 bytes`, correct MIME and attachment headers. |
| **G8 — HONESTY** | Five states, no invented values or dead controls | **GREEN** | `src/spine.test.tsx` (5 tests) checks all seven screens' loading/empty/error states plus the populated board pack and the versioned mapping editor; `scripts/fabrication.mjs`, `scripts/core-purity.mjs`, `scripts/no-native-deps.mjs` and the work-integrity scanners are green; no `console.log`, suppressed assertion, placeholder, or unwired control in product code. Absent plans print `not planned`, unmapped sources stay quarantined with a reason, and `mappingVersion 0` is an explicit unset token. |
| **G9 — E2E** | Coherent corpus + messy fixture; suite under 60s | **GREEN** | Corpus generated plan-first with independent non-`/core` integer-minor-unit oracle (`C1–C4`); messy fixtures checked against committed manifests. Final verify `54503ms < 60000ms`; CI run `45672240494` installed Chromium and passed the Playwright spine harness on the exact merged head. |
| **G10 — AUDIT** | Every write logged; every number traceable to a batch | **GREEN** | `/core/audit` hash chain + tamper tests; `verifyCompanyAuditLog` proven valid on company setup, chart/import/budget flows and all `coa_mapping.commit` writes (including the idempotent replay). `audit_log` is append-only by trigger; each financial read filters to active `import_batch` rows, so replaced batches remain history without double-counting. |

## Non-blockers and boundaries

- **Q-004** remains open: Firebase and the production postgres driver are CI-gated, not exercised in this sandbox. This was already disclosed and is not a Spine Gate.
- Neon migration parity is an optional CI job (`ENABLE_NEON_PARITY`) and is skipped when no Neon URL is configured; PGLite parity is proven locally by `schema-parity`.
- Period close/lock/reopen is `DEFERRED(M3)` under §12.6 (`CLS1–4`, DEC-008) and was deliberately not built in M1.
- Cut-line features (M2/M3: scenarios, drivers, connectors, PPTX, RBAC, approvals, etc.) remain untouched.

## Sign-off

M1 Spine G1–G10 are green with pasted evidence in `TASKBOARD.md` and a green CI run tied to the merged head. No gate was waived, weakened or skipped; all earlier red gates were fixed in product/workflow code and their diagnoses are retained in the ledger. The M1 exit condition of §2.2 is met.
