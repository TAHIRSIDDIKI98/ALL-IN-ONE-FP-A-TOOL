# Changelog

All notable changes to OneFP&A are recorded here under Semantic Versioning (`MASTER_PROMPT §12.15`).
Every claim maps to a `VERIFIED` gate in `TASKBOARD.md` (`Q6`).

## [0.2.0] - 2026-11-25 (M1 The Spine — in progress)

Milestone M1 is **not** complete; these are the verified increments so far (evidence in `TASKBOARD.md`).

### Added
- Spine persistence on PGLite/Postgres behind one `SqlExecutor` contract, audited atomic company setup, and session boundary (`WI-0012`, `WI-0013`).
- Schema-parity gate comparing migrations against the committed snapshot, plus the CI-gated Neon leg (`WI-0014`).
- Atomic idempotent import commit keyed on `(company_id, kind, source_hash)` with per-source replacement, full row accounting and chained audit (`WI-0015`).
- Trial balance + drill-to-source read model over active batches only (`WI-0016`), exposed over HTTP with typed errors and body ceilings (`WI-0017`).
- Year-to-date articulating statements (P&L / BS / indirect CF / retained earnings) with A1–A5 checks over HTTP (`WI-0018`).
- Browser API client, sign-in/setup wired to the API (`WI-0019`), server-driven statements screen (`WI-0020`), and a Playwright harness that drives the real API (`WI-0021`).
- Import Wizard + Model Grid served from the API, with ONE import classifier shared by a read-only company-scoped preview and the commit (`WI-0022`).
- Chart of accounts: pure CSV parser/validator (`/core/chart`), atomic audited chart import and chart read model over HTTP, and a working CoA screen — an import can now post instead of quarantining every row as unmapped (`WI-0023`).
- Budgets as plan data, not actuals: pure budget CSV parser (`/core/budget`), audited atomic import into `scenario` -> `plan_version` -> `plan_line` with version history, budget read model over HTTP, and a Budget panel in the Import Wizard that states plainly that no planned amount was posted to the GL (`WI-0025`).
- Board pack: one canonical row set drives the live preview and both XLSX/PDF exports, with an automated byte-level tie-out of engine == UI == XLSX == PDF (`WI-0027`, G7/U5/A6).
- Versioned CoA mapping: source codes discovered from retained import rows resolve through one `/core/mapping` kernel shared by preview and commit; every real edit writes a new audited version, with an inline two-pane mapper and typed quarantines (`WI-0028`, G1/G10).
- Budget-vs-Actual: `/core/variance` now builds account-level BvA rows (plan null ≠ zero plan, account-type favorability, separate `unplannedActual`), `GET /api/companies/:companyId/bva?period=` joins the current plan version to the trial balance, and the Statements BvA tab renders it with a G5 tie-out to the statement figures (`WI-0026`).
- Budget commits are refused by the GL write path instead of being posted as actuals (`WI-0024`).
- Planning workspace inside the Model Grid screen (`WI-0032`, `DEC-015`): an Actuals/Planning view switch on the existing seventh screen, a scenario inventory with each scenario's current plan version, a rolling forecast that tags every cell `actual`/`forecast` and prints `not posted`/`not planned` instead of zeros, and a scenario comparison that obeys the zero-base rules — all rendered from server decimal strings with per-read loading, typed error and retry states. `GET …/planning/rolling-forecast` now resolves an omitted `cutoffPeriod` to the last period with an active-batch posting, so the opening view is a real rolling forecast (`DEC-016`).
- Driver-plan authoring inside `/model-grid?tab=planning` across `fixed`, `growth_rate`, `percent_of_account`, and `price_times_volume` with period overrides, server dry-run preview, and named versioned scenario commit (`WI-0033`).
- M2 Collaboration & Workflow Engine (`WI-0034`, `DEC-017`): `0002_m2_collaboration.sql` (`approval_task`, `comment`, `job`, `notification`, expanded `membership.role` RBAC), pure `/core/workflow` state machine & canonical anchor/mention rules, transactional notification job dispatcher + chained audit, HTTP routes, and `WorkflowPanel` inside `/model-grid?tab=planning`.
- M2 Workforce Module (`WI-0035`, `DEC-018`): `0003_m2_workforce.sql` (`workforce_position`), declarative `WORKFORCE_MODULE_SPEC` + pure `/core/workforce` compiler proving `§2.4` One-Engine Law (`compileWorkforceModuleToDrivers` -> `/core/planning#computeDriverPlan`), golden oracle `/fixtures/oracles/workforce/workforce_oracle.json`, 4 company-scoped HTTP endpoints, and `WorkforcePanel` inside `/model-grid?tab=planning` tying directly into Rolling Forecast and BvA.
- M2 Flux Analysis Waterfall Bridge & Price-Volume-Mix (PVM) Decomposition Bridge (`WI-0036`): pure `/core/variance` `analyzeFlux` + `buildPvmBridge` tied against golden oracle `/fixtures/oracles/variance/flux_pvm_oracle.json`, `shared/variance.ts` wire contracts, company-scoped `GET /api/companies/:companyId/variance/flux` + `POST /api/companies/:companyId/variance/pvm`, and `FluxPvmPanel` inside `StatementsPage` (`/statements?tab=flux`, `DEC-015`).
- M2 PPTX Board Pack Export (`WI-0037`, `DEC-019`): widened `BoardPackExportFormatSchema` to `xlsx | pdf | pptx`, added `pptxgenjs@4.0.1` (`THIRD_PARTY_LICENSES.md` verified across 574 deps), implemented `renderPptx` (`LAYOUT_16x9` title slide, paginated section tables, and provenance slide rendered verbatim from `pack.rows[]`), added OOXML PresentationML MIME download support on `/api/companies/:companyId/board-pack/export`, exposed `Export PPTX` in `BoardPackPage` (`/board-pack`, `DEC-015`), and verified byte-level OOXML slide XML equality alongside live Chromium `.pptx` export.
- M2 Dashboards v1 & KPI Library (`WI-0038`, `§11.5`): single-definition KPI catalog (`METRIC_DEFINITIONS`, 18 KPIs) in `/core/metrics` wired into Dashboards, Report Builder (`100.00%` citation coverage), and Board Pack cover KPIs (`RPT1`/`RPT4`), multi-period SVG trend series (`buildKpiTrendSeries`), fingerprint-invalidated aggregate cache (`MetricsAggregateCache`, `RPT2`) tying identically to uncached engine output, `GET /api/companies/:companyId/dashboards`, and `DashboardsPanel` inside `/statements?tab=dashboards` (`DEC-015`).
- M2 Coherent Corpus v2 & Tenant B Isolation (`WI-0041`, `§7.8`, `§11.14`, `C1–C4`, `D2`, `TST5`): deterministic seed-reproducible Tenant B (`Northstar Manufacturing — DEMO — SYNTHETIC DATA`, NRF `454` calendar, leading-zero `001400` + `1400`), Rolling Forecast, Scenario Comparison, and Workforce fixtures tied cent-for-cent against independent `BigInt` oracle `/fixtures/oracles/expected/m2_corpus_expected.json` across both `/core` and live PGLite persistence with verified `TST5` cross-tenant isolation and `403 TENANT_FORBIDDEN` enforcement.

### Changed
- S-COMMIT (INT8) is enforced from an objective codex boundary (`DEC-007`) instead of a fixed-size exemption list.

## [0.1.0] - 2026-11-24 (M0 Foundation)

### Added
- Bootstrapped repository layout, constitutional governance (`MASTER_PROMPT.md` v1.2, `SPEC.md`, `TASKBOARD.md`), and GitHub Actions CI diagnostics (`WI-0001`).
- Implemented sandbox structural gates and ported honesty detectors `P01`–`P04` (`WI-0002`).
- Ported typed error catalog `P12` and canonical `zod` wire contracts (`WI-0003`).
- Ported and verified `/core/money` Decimal primitives, parser, string serializer, and largest-remainder allocator (`WI-0004`).
- Ported `P09` Class A NRF 2024–2028 calendar fixtures and verified `/core/calendar` generator `P10` (`WI-0005`).
- Ratified `MASTER_PROMPT.md` v1.2–v1.3 (Parts 11–13), third-party license compliance (`LIC1–3`), ADRs (`VER3`), and mechanical Work-Integrity Codex scanners & ratchet (`INT1–INT13`, `WI-0005B`, `WI-0005C`).
- Ported `/core/audit` pure TypeScript FIPS 180-4 SHA-256 canonical JSON hash chain (`WI-0006`, `P11`).
- Authored 18-table Postgres M1 schema migration (`0001_m1_spine.sql`), deferred balance & row-accounting triggers, append-only audit triggers, and PGLite constraint test suite (`WI-0007`).
- Ported Class A CoA (`P15`) & statement (`P18`) fixtures and verified `/core/statements`, `/core/variance`, and `/core/invariants` passing EBITDA `+300` and A1–A5 (`WI-0008`, `P17`, `P19`).
- Built deterministic plan-first Coherent Corpus v1 generator, `/core/import` messy CSV parser, synthetic messy-export manifests, and independent non-`/core` BigInt oracle verifier (`WI-0009`).
- Wired Express 5 spine API server, React 7-screen spine shell (`SignInPage`..`BoardPackPage`) with WCAG AA landmarks & five-state foundations, and Playwright E2E harness (`WI-0010`).
