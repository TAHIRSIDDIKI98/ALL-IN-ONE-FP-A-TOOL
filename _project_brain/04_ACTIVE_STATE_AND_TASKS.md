# 04 — Active state and tasks

**Last update:** 20 November 2026 · **Project stage:** **Per-Project Master Blueprint & Modular Architecture v4.0** (`../fpa-documentation/docs/23-per-project-master-blueprint-v4.0.md` + `../fpa-documentation/projects/*`) implemented across documentation, Secondary Brain, `BigInt` reference oracle (`40/40` invariants `I01`–`I40`, `atlas-fpa-v4.0-parity-vectors.json`), and interactive **Atlas FP&A** workbench (`frontend-builder/`); compiled Windows 11 multi-runtime binaries (`P1`–`P7`: `PRJ-CORE`, `PRJ-IO`, `PRJ-FLOW`, `PRJ-DOCS`, `PRJ-XLL`, `PRJ-DIST`) await Windows native build & host verification.

## Completed in this session — Per-Project Master Blueprint v4.0 (`PRJ-*` & `FPA-WORKSPACES`)
- **Modular Per-Project Blueprint System (`../fpa-documentation/projects/*` & `docs/23-per-project-master-blueprint-v4.0.md`)**:
  - Authored 7 standalone Engineering Sub-Project Blueprint Packs (**`PRJ-CORE`** Rust Engine & Vault, **`PRJ-IO`** Go Universal ERP Worker, **`PRJ-FLOW`** Elixir Close Orchestrator, **`PRJ-DOCS`** Java 25 OpenXML Renderer, **`PRJ-XLL`** Office 2021 x64 Excel Add-In, **`PRJ-UI`** Atlas Workbench & Oracle, **`PRJ-DIST`** Windows MSI/Security/QA) plus **`FPA-WORKSPACES`** (Multi-Project FP&A Isolation, Isolated CoA & Project P&L spec) and `projects/README.md` index.
- **Multi-Project FP&A Engine, `I37`–`I40` Invariants & Parity v4.0 (`frontend-builder/src/lib/omniBlueprintEngine.ts`)**:
  - **`I37` Sealed CoA Firewall (`validateProjectCoaBoundary`)**: Isolates each FP&A project (`PRJ-01`–`PRJ-04`) to its own `project_coa_id`, blocking cross-project CoA postings with `CROSS_PROJECT_COA_ISOLATION_VIOLATION`.
  - **`I38` Portfolio Consolidation FX Guard (`consolidateProjectPortfolio`)**: Consolidates eligible project actuals into group `USD` using exact scaled-integer FX and quarantines projects missing an explicit FX rate (`PARTIAL_EXCLUDED_MISSING_FX`, never `0`).
  - **`I39` Project WBS/EAC/PoC % P&L Tie-Out (`evaluateFpaProjectWorkspace`)**: Computes exact `BigInt` WBS rollup (`Revenue`, `Direct Cost`, `Gross Profit`), EAC, PoC % (`Cost / EAC` or `0` floor), and `0n` fils delta tie-out (`I39`).
  - **`I40` Engineering Sub-Project Traceability (`validateSubProjectTraceability`)**: Enforces 0-orphan coverage across all `7` modular packs (`PRJ-CORE`–`PRJ-DIST`), phases (`P0`–`P7`), and `I01`–`I40` invariants.
  - Extended parity contract schema to `atlas-fpa-omni-v4.0` and generated `/frontend-builder/public/demo/atlas-fpa-v4.0-parity-vectors.json` directly from `generateGoldenContractBundle()`.
- **Interactive Workbench Extensions (`frontend-builder/src/`)**:
  - Added **`ProjectWorkspaceHubCard`** (`Planning.tsx`), **`EngineeringSubProjectsCard`** (`Settings.tsx`), upgraded **`PolyglotArchitectureCard`** (`40/40` invariants, `Per-Project` filter, v4.0 parity export), and indexed all `PRJ-01`..`PRJ-04` workspaces & `PRJ-CORE`..`PRJ-DIST` packs in `Ctrl+K` (`App.tsx`).

## Preserved Prior Prototype & v3.0 Work
- 8-sector portfolio coverage (`Packaging`, `Metals`, `Property` active + `Foods`, `Development`, `Mobility`, `Infrastructure`, `Investments`), `domainRules.ts`, `ERP-01`–`ERP-12` (`I33`), UAE Art. 51 EOSB & CapEx NBV (`I34`), 13-week Cash DSCR & PVM bridge (`I35`), `P0`–`P7` Master Execution Roadmap (`I36`), and all `journey_test.py` DOM contracts.

## Remaining Production & Environment Gates (`P1`–`P7`)
- **Gate 1 (`P1`–`P6`) — Native Windows 11 Multi-Runtime Build**: Compile and wire `PRJ-CORE` (`fpa-core.exe`), `PRJ-IO` (`fpa-io.exe`), `PRJ-FLOW` (`fpa-flow --start-epmd false`), `PRJ-DOCS` (`fpa-docs.exe`), and `PRJ-XLL` (`fpa-xll.xll`) on Windows x64 against `atlas-fpa-v4.0-parity-vectors.json`.
- **Gate 2 (`P4`, `P7`) — Office 2021 64-bit Excel Host & `PRJ-DIST` MSI Verification**: Sign and execute live `=FPA.GET(...)` + Command write-back acceptance tests on real Microsoft Excel x64 and offline Windows 11 Enterprise VM.
- **Gate 3 — Legal Perimeter & Statutory Sign-Off (`GAP-001`–`GAP-006`)**: Group finance sign-off on actual legal ownership/consolidation scope and qualified UAE tax/labor adviser review before processing any live corporate data.

## Actual verification in this environment
- Unit tests (`npx --yes tsx --test frontend-builder/src/lib/domainRules.test.ts frontend-builder/src/lib/omniBlueprintEngine.test.ts`): **17/17 subtests passing** covering v2.2 + v3.0 + v4.0 (`I01`–`I40`, `PRJ-01`–`PRJ-04`, `PRJ-CORE`–`PRJ-DIST`, `atlas-fpa-omni-v4.0`).
- Build, lint, and live headless Chromium verification (`compile_applet`, `lint_applet`, `playwright-cli` on `1440x900` & `390x844`): executed after UI integration (see `UI_FEATURE_MATRIX.md` Section 4).
- Python Playwright scripts (`smoke_test.py`, `journey_test.py`, `contrast_audit.py`) cannot run directly here (`playwright` Python package not installed), and Windows native runtime / Office 2021 Excel tests remain unexecuted in this Linux container.

## Immediate next steps
1. Explore **Atlas FP&A v4.0** across Planning (**Multi-Project FP&A Workspaces, Isolated CoA & Project P&L `I37`–`I39`**), Settings (**7 Modular Engineering Sub-Project Blueprint Packs `PRJ-CORE`–`PRJ-DIST` `I40`**, `40/40` invariants, `Export parity JSON`), and `Ctrl+K` (`PRJ-01`–`PRJ-04` / `PRJ-CORE`–`PRJ-DIST`).
2. Export `atlas-fpa-v4.0-parity-vectors.json` from Settings and follow Phases `P1`→`P7` using each sub-project's modular pack in `fpa-documentation/projects/` on the Windows 11 build machine (`READ → VERIFY → ACT → MEMORIZE`).

