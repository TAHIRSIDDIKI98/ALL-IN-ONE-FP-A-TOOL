# Atlas FP&A

**Frontend prototype only. Not a production application. All data, entities, actors, sources, and activity are fictional.**

A desktop-first financial workbench built with React, Vite, TypeScript, and Tailwind CSS, with bundled Lucide icons and system fonts. There is no financial engine, backend, database, authentication, corporate connection, native Excel add-in, or production encryption.

## Run locally

```bash
npm install
npm run dev -- --host 0.0.0.0
```

Production-bundle preview:

```bash
npm run build
npm run preview -- --host 0.0.0.0
```

Open the local address printed by Vite. Hash navigation works without server rewrites. Runtime assets are bundled locally; no CDN, remote font, external image, API key, login, fetch call, or external service is required. Dependency installation requires the package registry unless dependencies are already installed.

## Screens and interactions

1. **Overview:** January 2026 actuals by default. Scope, period, and scenario selectors; four KPIs; revenue/expense trend; accessible chart/table toggle; business variance tabs; source drawers; attention links. Management totals are explicitly **unadjusted**, not consolidated.
2. **Financial statements:** Income Statement, Balance Sheet, and Cash Flow tabs; expandable business inputs; fictional provenance; partial and missing-data states. Unsupplied inputs show **Not provided**, not invented values or zero.
3. **Planning & scenarios:** Actual / Budget / Forecast / Variance; January–March fixtures; base, upside, and cautious presets; local editable assumption; reset. Only -5%, 0%, and +5% select fixed, predetermined outputs. Includes an interactive **UAE VAT & Corporate Tax preview** (`UaeTaxPreviewCard`) powered by `BigInt` scaled-integer half-even math (Docs/11 `U-02` exclusive/inclusive VAT, `U-03` 9% above AED 375,000, and `NEEDS_REVIEW` stops for Free Zone / QFZP / grouping). These are illustrative previews, not financial modeling, tax filings, or saved forecasts.
4. **Group consolidation:** Six workflow stages; reporting selection; readiness; a separate missing reference FX rate; intercompany mismatch; adjustment preview; blocked review. The final action is intentionally unavailable and no consolidated output is produced for the workspace totals. Includes an interactive **Golden Consolidation simulator** (`ConsolidationGoldenCard`, Docs/19) demonstrating balanced 80/20 NCI elimination (`Assets 120`, `Parent Equity 100`, `NCI 20`) vs. explicit `CONS-001` (missing ownership) and `CONS-004` (`11 vs 10` unmatched IC) blockers, plus separate `100 AED k` dividend boundary behavior (`T-AG-01`).
5. **Data imports:** CSV/Excel-layout selection; bundled example; optional local synthetic CSV filename display; mapping; missing/zero/error examples; simulated loading; validation preview; explicit demo confirmation. File contents are never read, parsed, stored, or uploaded. Mapping rows always come from the bundled fixture, never the chosen file.
6. **Excel integration:** Not connected; read-only worksheet visualization; stale-data example; simulated pull; editable proposed value and explicit write-back confirmation. The final message says nothing was written. No workbook is opened, modified, or created.
7. **Audit & activity:** Six static mock entries with actor, action, timestamp, scope, revision, and result; search and category filters; detail drawers; empty filter state. Interactions do not create audit events. No immutable, signed, or persisted audit system exists.
8. **Settings:** Table density, digit grouping, motion reduction, optional inline guidance, reporting period, fictional workspace label, and full reset. Every enabled preference changes visible UI. AED is fixed because FX conversion is not implemented.

**Global interactions:** sidebar navigation and browser hash history; Ctrl+K search (including all 8 target sectors); Escape closes dialogs; keyboard focus; a blank workspace demonstrating an empty state; persistent `Prototype · Synthetic data` and `Offline demo` labels. Native dialogs trap focus and restore it when closed. Tables have headers and accessible captions. Charts include textual values and a table alternative.

## In-place UI/UX refinement & domain previews

The existing workbench now supports connected review journeys across all 8 target sector templates (`Packaging`, `Metals`, `Property` active fixtures plus `Foods`, `Development`, `Mobility`, `Infrastructure`, `Investments` `Not provided` templates): investigate a variance, drill into a fictional business, inspect `T-AG-01` / `T-AG-07` / `T-AG-08` unit and scope boundaries, test illustrative UAE tax and Golden Consolidation rules, inspect reporting blockers, review a filename-only CSV preview, inspect Excel status, and open related mock activity.

- Variance contribution drawers and fictional sector profiles link directly to the relevant entity view and include interactive `T-AG-08` unit-mismatch (`Foods`), `T-AG-07` weighted occupancy (`Development`), and `T-AG-01` dividend-separation (`Investments`) boundary checks.
- Pure `BigInt` scaled-integer rule helpers (`src/lib/domainRules.ts`) decouple illustrative UAE VAT/CT, Golden Consolidation, weighted occupancy, and unit-conversion checks from React UI components and avoid binary floating-point arithmetic (`f64`) on monetary/rate amounts.
- Context-sensitive drawer actions stay in a fixed footer on desktop and mobile.
- Planning presets have bounded undo/redo; Excel draft edits, import mappings/reset, and workspace labels have local reversal actions.
- Import filename/mapping/step metadata survives navigation in React memory; errors must be reviewed and mappings corrected before demo confirmation.
- Reporting inspection markers remain separate from unresolved financial blockers.
- Excel availability includes explicitly simulated loading/unavailable/retry states.
- Tabs, command search, error recovery, and mobile navigation have keyboard/focus behavior; Settings includes a live display preview.
- No runtime dependency was added or upgraded. The original financial fixtures and synthetic CSV are unchanged.

Detailed journeys, design decisions, inspection findings, modifications, evidence, and limitations are documented in `docs/UI_DESIGN_NOTES.md` and `docs/UI_FEATURE_MATRIX.md`.

## Data & boundary

All values use **AED thousands**. Default supplied inputs:

| Fictional business | Revenue | Operating expenses | Operating result |
| --- | ---: | ---: | ---: |
| Synthetic Packaging | 1,000 | 750 | 250 |
| Synthetic Metals | 1,600 | 1,300 | 300 |
| Synthetic Property | 500 | 200 | 300 |
| **Unadjusted management total** | **3,100** | **2,250** | **850** |

Cash is **Not provided**. January budget: 3,000 revenue, 2,200 expenses, 800 operating result. Base forecast: 3,140 revenue, 2,250 expenses, 890 operating result. Historical and planning comparisons are entirely fictional.

Simple integer summaries and display-only percentage comparisons are not authoritative accounting calculations. Operating result is not labeled EBITDA. No ownership, legal perimeter, elimination, adjustment, FX rate, or accounting policy is inferred from entity names.

The missing USD→AED reference rate and 120/110 intercompany items are separate illustrative fixtures, not silently included in AED management inputs. No real company branding, client information, corporate relationship, or endorsement is used.

## Session-only state & offline assumptions

- React state only: no localStorage, IndexedDB, server storage, or uploaded-content storage.
- Reload resets state. Global selectors, applied planning presets/undo history, import filename/mapping/step metadata, inspection markers, activity search, and preferences remain in React memory while navigating. Unapplied assumptions, Excel draft values, category filters, and label-undo state are screen-local.
- `Offline demo` describes the absence of production connections. The browser still needs the local Vite/static server to load assets. No installable offline application or service-worker cache is implemented.
- The UI runs without internet after dependencies are installed and local assets are served. A native Windows 11 / Office 2021 x64 Excel add-in and fully offline production operation are **future requirements**, not implemented features.
- File download is limited to the bundled synthetic CSV. No workbook or imported financial artifact is generated.
- No accounting accuracy, regulatory compliance, completed consolidation, authentication, secure encryption, or real audit persistence is claimed. Legal scope and policies require expert approval.
- A narrowly scoped Vite transform excludes known hosting-injected recording/view scripts from the local served/build output. The local authoring helper is retained. This is not production security or encryption.

## Source map & renaming

- `src/App.tsx`: shell, selectors, hash navigation, session state, `Ctrl+K` search (indexing all 8 UAE sectors, all 10 global industry packs, and v2.2/v3.0 tools), resets.
- `src/lib/data.ts`: app name, fictional workspace name, fixtures, integer presentation summaries, predefined planning outputs.
- `src/lib/domainRules.ts` & `src/lib/domainRules.test.ts`: pure `BigInt` scaled-integer domain calculators (`U-02` UAE VAT, `U-03` UAE Corporate Tax, Docs/19 Golden Consolidation, `T-AG-07`/`08` guards).
- `src/lib/omniBlueprintEngine.ts` & `src/lib/omniBlueprintEngine.test.ts`: v2.2, v3.0 & v4.0 reference engine covering all 10 global industry blueprint packs (`BP-01`–`BP-10` with `0` orphan warnings), Largest-Remainder exact-sum allocator (`I05`), 100M+ cell Block-Hybrid memory & mmap spill estimator, source-scoped ingestion gate (`IMP-GL` vs `IMP-SUB`, fixing `OQ-025`/`K2`/`K3`), synchronous FIPS 180-4 SHA-256 hash-chain verifier (`I22`), Excel XLL `=FPA.GET`/idempotency oracle (`I20`/`I28`), multi-period statement policy & Kahn's acyclic DAG solver (`I08`/`I09`/`I27`), Universal Top-12 ERP Adapter Catalog & SCD2 CoA normalizer (`I33`), Workforce UAE Art. 51 EOSB Gratuity + CapEx NBV Roll-Forward (`I34`), 13-Week Direct Cash Flow & DSCR Guard + Price-Volume-Mix Variance Bridge (`I35`), 8-Phase Gated Execution Roadmap (`P0`–`P7`, `I36`), **Multi-Project FP&A Workspaces, Isolated CoA & Project P&L / WBS / PoC Engine (`I37`–`I39`)**, **7 Engineering Sub-Project Blueprint Packs Registry (`I40`)**, 5-language contract registry with Rust fallbacks, machine-readable `generateGoldenContractBundle()` parity exporter (`atlas-fpa-v4.0-parity-vectors.json`), and live 40-invariant verification runner (`I01`–`I40`).
- `src/lib/workspace.ts`: typed shared React context.
- `src/lib/reviewData.ts`: fictional sector prompts, extended 5-sector template definitions (`Foods`, `Development`, `Mobility`, `Infrastructure`, `Investments`), filename-only import state shape, and mock-activity destinations.
- `src/lib/useUndoState.ts`: bounded, session-only UI undo/redo.
- `src/components/`: reusable cards, `UaeTaxPreviewCard.tsx`, `ConsolidationGoldenCard.tsx`, `BlueprintStudioCard.tsx`, `StatementPolicyCard.tsx`, `HyperblockScaleCard.tsx`, `OneStopFpaSuiteCard.tsx`, `ProjectWorkspaceHubCard.tsx`, `SubLedgerGateCard.tsx`, `ErpUniversalMapperCard.tsx`, `ExcelXllContractCard.tsx`, `AuditChainCard.tsx`, `PolyglotArchitectureCard.tsx`, `MasterRoadmapBlueprintCard.tsx`, and `EngineeringSubProjectsCard.tsx`.
- `src/components/Tabs.tsx` and `src/components/review.tsx`: keyboard tabs, variance investigation, 8-sector portfolio template switcher/drawers (`T-AG-01`/`07`/`08` boundary boxes), and contextual handoffs.
- `src/pages/`: eight interactive screens.
- `src/index.css`, `src/styles/workbench.css`, and `src/styles/refinements.css`: Tailwind base, preserved workbench, WCAG-AA slate contrast tokens, and responsive hairline card refinements.
- `public/demo/synthetic-january-2026.csv`: downloadable fictional example.
- `docs/UI_DESIGN_NOTES.md` and `docs/UI_FEATURE_MATRIX.md`: journey design notes and feature/limitation traceability matrix.

## Validation

- `npx --yes tsx --test frontend-builder/src/lib/domainRules.test.ts frontend-builder/src/lib/omniBlueprintEngine.test.ts` (from repo root) — **passed (`17/17` `node:test` suites)**: verifies `BigInt` half-even math, UAE VAT/CT, Golden Consolidation (`CONS-001`/`004`/`T-AG-01`), `T-AG-07`/`08`, all 10 industry blueprint packs (`0` orphan formulas), Largest-Remainder `I05` allocator, 100M+ Block-Hybrid estimator, `IMP-GL`/`IMP-SUB` ingestion gate (`OQ-025`/`K2`/`K3`), FIPS 180-4 SHA-256 chain tamper pinpointing (`I22`), Excel XLL `=FPA.GET`/15-sig-digit/`I28` idempotency, Q1 `RATIO_OF_SUMS`/acyclic DAG (`I08`/`I09`/`I27`), Top-12 Universal ERP adapters & CoA quarantine (`I33`), Workforce UAE Art. 51 EOSB + CapEx Roll-Forward (`I34`), 13-Week Direct Cash DSCR + PVM Bridge (`I35`), 8-Phase Gated Execution Roadmap (`I36`), sealed Multi-Project FP&A CoA isolation (`I37`), missing-FX consolidation quarantine (`I38`), WBS/EAC/PoC Project P&L (`I39`), 0-orphan 7-pack Engineering Sub-Project traceability (`I40`), v4.0 parity bundle export, and all `40/40` invariants.
- `npm run build` (`tsc -b && vite build`) — **passed** cleanly.
- `npm run lint` (`eslint .`) — **passed** with zero errors or warnings.
- Live headless Chromium verification (`playwright-cli` on `http://localhost:3000`): verified desktop (`1440x900`) & mobile (`390x844`) layouts, zero horizontal overflow across all 8 routes, preserved `journey_test.py` DOM contracts, interactive v4.0 Multi-Project Hub & 7 Engineering Sub-Project explorer, `Export parity JSON`, and 40-invariant oracle with zero console errors or failed requests.
- **Not run in current Linux container**: Python Playwright suites (`smoke_test.py`, `journey_test.py`, `contrast_audit.py`) cannot execute natively because Python lacks the `playwright` package here, and compiled Windows 11 native executables (`fpa-core.exe`, `fpa-io.exe`, `fpa-flow`, `fpa-docs.exe`, `fpa-xll.xll`) and Office 2021 64-bit Excel host tests remain unbuilt/untested.

This repository prototype uses synthetic data and reference TypeScript calculators only; compiled Windows native binaries and statutory accounting sign-offs remain separate build gates.

