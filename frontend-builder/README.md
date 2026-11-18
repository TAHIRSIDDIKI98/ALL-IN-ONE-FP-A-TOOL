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
3. **Planning & scenarios:** Actual / Budget / Forecast / Variance; January–March fixtures; base, upside, and cautious presets; local editable assumption; reset. Only -5%, 0%, and +5% select fixed, predetermined outputs. These are illustrative previews, not financial modeling or saved forecasts.
4. **Group consolidation:** Six workflow stages; reporting selection; readiness; a separate missing reference FX rate; intercompany mismatch; adjustment preview; blocked review. The final action is intentionally unavailable. No consolidated output is produced.
5. **Data imports:** CSV/Excel-layout selection; bundled example; optional local synthetic CSV filename display; mapping; missing/zero/error examples; simulated loading; validation preview; explicit demo confirmation. File contents are never read, parsed, stored, or uploaded. Mapping rows always come from the bundled fixture, never the chosen file.
6. **Excel integration:** Not connected; read-only worksheet visualization; stale-data example; simulated pull; editable proposed value and explicit write-back confirmation. The final message says nothing was written. No workbook is opened, modified, or created.
7. **Audit & activity:** Six static mock entries with actor, action, timestamp, scope, revision, and result; search and category filters; detail drawers; empty filter state. Interactions do not create audit events. No immutable, signed, or persisted audit system exists.
8. **Settings:** Table density, digit grouping, motion reduction, optional inline guidance, reporting period, fictional workspace label, and full reset. Every enabled preference changes visible UI. AED is fixed because FX conversion is not implemented.

**Global interactions:** sidebar navigation and browser hash history; Ctrl+K search; Escape closes dialogs; keyboard focus; a blank workspace demonstrating an empty state; persistent `Prototype · Synthetic data` and `Offline demo` labels. Native dialogs trap focus and restore it when closed. Tables have headers and accessible captions. Charts include textual values and a table alternative.

## In-place UI/UX refinement

The existing workbench now supports connected review journeys: investigate a variance, drill into a fictional business, compare statements and planning, inspect reporting blockers, review a filename-only CSV preview, inspect Excel status, and open related mock activity.

- Variance contribution drawers and fictional sector profiles link directly to the relevant entity view.
- Context-sensitive drawer actions stay in a fixed footer on desktop and mobile.
- Planning presets have bounded undo/redo; Excel draft edits, import mappings/reset, and workspace labels have local reversal actions.
- Import filename/mapping/step metadata survives navigation in React memory; errors must be reviewed and mappings corrected before demo confirmation.
- Reporting inspection markers remain separate from unresolved financial blockers.
- Excel availability includes explicitly simulated loading/unavailable/retry states.
- Tabs, command search, error recovery, and mobile navigation have keyboard/focus behavior; Settings includes a live display preview.
- No dependency was added or upgraded. The original financial fixtures and synthetic CSV are unchanged.

Detailed journeys, design decisions, inspection findings, modifications, evidence, and limitations are documented in `docs/UI_DESIGN_NOTES.md`.

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

- `src/App.tsx`: shell, selectors, hash navigation, session state, search, resets.
- `src/lib/data.ts`: app name, fictional workspace name, fixtures, integer presentation summaries, predefined planning outputs. Change `APP_NAME` and `DEFAULT_WORKSPACE` to rename the working title/workspace; update the static HTML title and favicon as appropriate.
- `src/lib/workspace.ts`: typed shared React context.
- `src/lib/reviewData.ts`: fictional sector prompts, filename-only import state shape, and mock-activity destinations.
- `src/lib/useUndoState.ts`: bounded, session-only UI undo/redo.
- `src/components/`: reusable cards, badges, tables, selectors, native dialogs, source details, SVG chart.
- `src/components/Tabs.tsx` and `src/components/review.tsx`: keyboard tabs, variance investigation, business profiles, and contextual handoffs.
- `src/pages/`: eight interactive screens.
- `src/index.css`, `src/styles/workbench.css`, and `src/styles/refinements.css`: Tailwind base, the preserved workbench, and targeted UI/accessibility refinements.
- `public/demo/synthetic-january-2026.csv`: downloadable fictional example.

## Validation

- `npm run build` — **passed** (TypeScript project build followed by Vite production bundling).
- `npm run lint` — **passed**, zero errors or warnings.
- `python scripts/smoke_test.py` — **passed: 90 regression checks**.
- `python scripts/journey_test.py` — **passed: 143 end-to-end journey checks**.
- `python scripts/contrast_audit.py` — **passed: 1,513 text samples across 22 states**, zero below the audit thresholds. This is a focused rendered-text check, not accessibility certification.

The **233 browser checks** report zero browser runtime errors and zero external runtime requests, no file-content API reads, and no localStorage/sessionStorage use. Tested at 1440 × 900, 1366 × 768, 1024 × 900, 390 × 844, and 360 × 800.

The optional test harnesses need Python Playwright and Chromium (already available in the build workspace). They start temporary local static-file servers, test the built `dist` bundle, and shut the servers down on completion. They are not application backends. The core report is `artifacts/test-report.json`; journey/contrast reports and before/after screenshots are in `artifacts/ui-upgrade/`.

Browser checks cover navigation, numerical consistency, selectors, source drawers, dialog focus restoration, scenario editing, loading/empty/missing/error displays, filename-only selection without content reads, import and Excel confirmations, resets, responsive layout, and absence of browser storage or external runtime requests.

This project intentionally does not include production accounting tests, ledger validation, approval systems, native integration, or security infrastructure.
