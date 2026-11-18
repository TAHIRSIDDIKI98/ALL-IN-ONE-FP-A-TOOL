# Atlas FP&A — UI/UX refinement and handoff

## 1. Scope: improve the existing workbench

This is an in-place refinement of the existing Atlas FP&A frontend, not a replacement application or a financial-system implementation. The eight existing screens, hash routes, application identity, original actual figures, and downloadable synthetic CSV are preserved.

The prototype remains explicitly fictional. Its management totals are **unadjusted**, cash remains **Not provided**, and the reporting workflow remains **Incomplete · not consolidated**. No real financial record, workbook, integration, or audit event is changed by any interaction.

### Repository inspection

Inspected `src/App.tsx`, all eight page components, shared components, data/context modules, styles, `package.json`, Vite configuration, README, existing tests, and the previously built UI. No `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, contribution guide, or additional repository rules were found in the available workspace.

The existing stack is React, Vite, TypeScript, Tailwind CSS, and locally bundled Lucide icons. The existing `dev`, `build`, `lint`, and `preview` scripts remain unchanged. **No package was added, removed, or upgraded.** No repository reset, competing project, or deletion of existing work was performed.

### What the inspection revealed

| Finding | Refinement |
| --- | --- |
| A visible variance did not provide a complete investigation path. | Clickable variance values, a contribution drawer, business drill-down, source tab, and contextual links to statements and planning. |
| Source and activity drawers mostly ended at “Close.” | Context-sensitive forward actions, pinned in the dialog footer rather than hidden below scrolling content. |
| The same small, pale secondary text appeared across important states. | Shared readable text tones, strengthened typography, visible focus treatment, and an actual rendered-text contrast audit. |
| Planning changes had reset but no undo/redo. | A bounded, session-only history for predefined scenario previews; reset-to-base is also undoable. |
| Leaving imports discarded the selected filename and mapping progress. | Filename-only preview metadata now survives screen navigation in React state, with explicit session-only labeling. |
| An incomplete mapping could reach the confirmation screen. | Confirmation is gated on reviewed demo checks and complete field mapping; error recovery returns focus to the exact unmapped field. |
| Excel status had no availability-check journey. | An explicitly simulated loading/unavailable/retry sequence; no native detection or connection is attempted. |
| Audit details had no related-workflow handoff. | Visible removable search context and links from each fixed mock entry to its related demo workflow. |
| Tab roles did not implement a full keyboard interaction pattern. | Reusable tabs with ArrowLeft/ArrowRight, Home/End, roving focus, and labeled panels. |
| A paired handoff action row overflowed at 390 px during testing. | Bounded, wrapping mobile action containers; long filenames and long search strings are also tested. |
| Previously injected hosting recorders requested an external CDN and a page-view endpoint. | A narrowly scoped Vite HTML transform removes the known recording/view scripts from the served/build output. The local authoring helper is retained. |

## 2. Design system

### Visual direction

Preserve the existing financial workbench: warm light canvas, white surfaces, deep navy navigation, restrained teal actions, amber warnings, and red only for errors. No marketing hero, gradients, remote images, or remote fonts were introduced.

- **Canvas:** `#f5f6f4`.
- **Navigation:** existing `#152231` navy.
- **Primary text:** `#253244`.
- **Secondary text:** `#5d6c79`; contextual green-gray text uses `#526b5b`.
- **Primary action:** existing `#197d68` teal.
- **Surfaces:** white, subtle gray-green borders, 6–8 px radii.
- **Typography:** local/system fonts, prioritizing Segoe UI for Windows; approximately 28 px page titles, 33 px KPIs, 12 px controls/table text, and compact supporting metadata.
- **Numbers:** tabular numeric presentation, consistent AED-thousands context, signed variances, and optional digit grouping.
- **Density:** the existing comfortable/compact preference remains functional and now has an immediate table preview in Settings.

The overview retains its KPI row, trend/attention split, and business table. The unadjusted management total remains visible within the default **1440 × 900** viewport. Richer business context sits below that executive summary, rather than replacing the financial information.

### Reusable interaction components

- Existing cards, badges, buttons, tables, notes, selectors, and native dialogs remain the foundation.
- `Tabs.tsx` supplies consistent semantics and keyboard navigation for statements, Excel, and variance details.
- `DialogActions` uses a local React portal to place context-sensitive actions in the fixed dialog footer. Actions still receive the current drilled business scope.
- `VarianceReview` provides Actual/Budget comparisons, signed contributions, source lineage, and follow-on actions.
- `BusinessDrivers` / `BusinessProfile` provide reusable fictional sector context.
- `NextStep` makes cross-screen handoffs explicit, with meaningful descriptions rather than generic “Continue” links.
- `useUndoState` provides bounded in-memory UI history. It is not financial versioning.

### Accessibility and orientation

- Every screen has a real heading; contextual navigation moves focus to the new heading.
- Native dialogs trap focus, close with Escape, and restore the originating focus when appropriate.
- Forward actions remain visible in the dialog footer on desktop and mobile.
- Tabs use one keyboard tab stop and support arrows plus Home/End.
- Ctrl+K search exposes the highlighted option with `aria-activedescendant`; Arrow keys select and Enter opens that option.
- Mobile navigation announces its expanded state, focuses the current screen, traps focus while open, and returns focus to the trigger on Escape.
- Errors have visible explanations and semantic invalid/error states. Mapping recovery focuses the actual field needing attention.
- Tables have captions and header cells; wide tables scroll within their own region instead of widening the page.
- Chart values are also available as a text/table view. KPI mini-trends are supplementary, non-interactive decoration.
- Status is not communicated by color alone: “Not provided,” “On plan,” “Unfavorable,” “Unresolved,” “Simulated,” and “Incomplete” are written explicitly where relevant.
- Reduced-motion behavior respects both the operating-system preference and the local UI setting.

## 3. Complete user journeys

### Journey A — identify and investigate an overview variance

**Start:** Overview, All businesses, January 2026, Actual, AED thousands.

1. Read revenue **3,100**, operating expenses **2,250**, operating result **850**, and cash **Not provided**.
2. Select **Review revenue variance** below the trend, or a variance in the business table.
3. The group drawer compares Actual **3,100** with Budget **3,000**, showing **+100**.
4. Inspect the contributions: Packaging **+50**, Metals **+50**, Property **0 · On plan**.
5. Drill into Synthetic Packaging. Its comparison is **1,000 / 950 / +50**.
6. Switch to **Source & lineage**; the source tab contains only the selected business, not the group total.
7. Use **Back to all contributions**, or continue through the pinned **Compare in statements** action.

**Outcome:** the selected entity is retained in statements. Nothing is adjusted or posted. Contributions explain the arithmetic difference only, not the commercial cause.

**Recovery:** Escape/Close returns to the unchanged overview. The drawer back action restores the group contribution view. All reporting selectors remain usable.

### Journey B — compare actual, budget, and a planning preview

1. Review the Income statement's three supplied operating measures; expand or collapse business inputs.
2. Select an available amount for source detail or a variance for the same comparison drawer.
3. Switch the toolbar to Budget if desired: comparison columns correctly become Budget versus Actual, not two Budget columns.
4. Inspect Balance sheet or Cash flow. Unsupplied inputs remain **Not provided**; no balancing figures or cash calculations are invented.
5. Choose **Compare scenarios**. The current business scope is retained.
6. For All businesses in January, the fixed base forecast is **3,140 / 2,250 / 890** for revenue/expenses/result.
7. Enter **5** or select the Upside preset. The fixed output becomes **3,297 / 2,250 / 1,047**.
8. Use **Undo**, **Redo**, or **Reset demo**. Reset-to-base can itself be undone.
9. Try an unsupported assumption such as **3**. An error is shown, the input receives focus, and the last applied comparison stays unchanged.
10. Continue with **Review group reporting**.

**Outcome:** a reversible, illustrative comparison, not a financial model or an approved forecast. Actual and budget fixtures never change. February/March actuals and all cash inputs remain missing.

**Recovery:** select a supported preset (-5, 0, or 5), undo a preset change, or reset the demo. Undo concerns applied presets, not the independent month selector.

### Journey C — review group reporting without a fake consolidation

1. Enter **Entity readiness** from planning or the statement comparison guide.
2. Review the reporting scope and the three fictional businesses. Selection is not an ownership/control conclusion.
3. Open **Currencies & rates** and inspect the missing USD→AED reference rate. The rate and its source remain **Not provided**.
4. Optionally select **Mark as inspected**. This only changes a reversible UI marker.
5. Inspect **Intercompany**: the separate reference fixture shows receivable **120**, payable **110**, and difference **10** AED thousands.
6. Mark that example inspected as well. The UI can show **2 of 2 inspected**, but both blockers still remain unresolved.
7. Open **Review**. It still says **Incomplete · not consolidated** and **No consolidated output is available**. The final action remains disabled.
8. Continue to **Open import preview**, or inspect the related fixed mock review activity.

**Outcome:** a useful review walkthrough that cannot execute consolidation, post eliminations, fill a missing rate, or establish accounting policy.

**Recovery:** each inspection can be undone; all markers can be cleared. Scope checkboxes remain reversible. No audit event is written by marking an example inspected.

### Journey D — select a synthetic CSV and recover from mapping errors

1. Use the supplied example, download its synthetic CSV, or choose/drop a local synthetic CSV.
2. Only the **filename** is retained. File contents are never read, parsed, uploaded, or stored. The file input is cleared after the name is read.
3. Selecting an unsupported extension produces an actionable error. Dropping a workbook while exploring Excel layout explicitly explains that workbook selection is not implemented; changing source type clears that error.
4. Continue to **Map fields**. These rows always come from the bundled January fixture, never the selected file's contents.
5. Unmap Revenue to explore an error. **Undo mapping edit** restores the prior selection.
6. Run **Demo checks**. A real local loading state is shown; progression is disabled while it runs.
7. If a field is unmapped, confirmation remains unavailable. **Fix mappings** returns to and focuses the exact field.
8. Restore the example mapping and replay the checks. Missing cash is still missing; explicit zero and invalid-account examples remain separate concepts.
9. Continue to **Confirm demo**. The dialog states **Demo only — no financial data committed**.
10. Continue directly to **Inspect Excel status**.

**Outcome:** an interface demonstration, not an import. A reviewed preview is not accounting assurance.

**Recovery and continuity:** the filename, mappings, validation-preview state, and current step survive navigation to Excel and back. **Reset flow** clears the preview; **Undo reset** restores that metadata. No original file handle or contents are restored because none were retained.

### Journey E — inspect Excel availability and a proposed write-back

1. The screen clearly starts at **Not connected · prototype**.
2. Select **Check availability · demo**. It shows a loading state and then **Native add-in unavailable in this prototype**.
3. Retry the demonstration. It still explicitly says no Excel process was detected, contacted, or connected.
4. Explore **Data pull preview**: only the bundled values are shown. A stale-data warning remains because no actual freshness check exists.
5. Switch to **Write-back preview** using the tabs or arrow keys.
6. Edit a proposed value, undo the edit, or restore the fixture value. These affect the draft input only.
7. Enter an unsupported fractional/negative value to see validation; correct it before opening the review.
8. Review current versus proposed values, then either cancel or **Simulate confirmation**.
9. The outcome says **Simulation ended — nothing was written**. All original financial values remain unchanged.
10. Use the pinned/next-step **View mock Excel activity** action, or return to a retained import preview.

**Outcome:** the shape of a future read/write workflow, not a native add-in or workbook operation. Office 2021 x64 and fully offline production operation remain future requirements.

**Recovery:** retry the unavailable-state example, undo draft edits, restore the fixture value, or cancel confirmation. Timers are cleaned up on navigation/context changes so a departed workflow cannot open a delayed result dialog elsewhere.

### Journey F — open and contextualize a mock audit entry

1. Enter activity through **View mock Excel activity**.
2. A visible, removable **Excel** search context filters the six static entries to the original Excel example.
3. Open **MOCK-003**. Review its fictional actor, timestamp, scope, revision, result, and provenance.
4. Read the distinction between a fixed example and an actual audit event. Interactions have not appended any entry.
5. Use **Open Excel preview** to enter the relevant current fictional business workflow.
6. Alternatively, clear filters and return to the management overview.

**Outcome:** contextual navigation across the same prototype. It does not restore historical records, replay a real action, or access a persisted audit system.

**Recovery:** clear the search chip or all filters, use the empty-state recovery action, close the drawer, or open another entry.

### Supporting journey — reversible preferences

Settings includes a live sample table for density and digit grouping, operating-system/local reduced-motion behavior, optional explanatory guidance, an immediate reporting-period preference, and a fictional workspace label. Label edits can be undone. The full reset asks for confirmation and deliberately clears session metadata and undo history. The synthetic-data indicator cannot be hidden.

## 4. Fictional business and sector examples

These profiles enrich the review conversation without inventing operational measurements or causal variance bridges.

| Business | Fictional operating example | Review drivers |
| --- | --- | --- |
| Synthetic Packaging | Transit cartons and protective packaging; recurring and short-run orders. | Order volume/mix, board and resin assumptions, production yield. |
| Synthetic Metals | Made-to-order fabricated components in a small-batch operation. | Shipment timing, material/energy assumptions, capacity utilisation. |
| Synthetic Property | Lettable spaces and shared facilities in a small fictional portfolio. | Occupancy/space, lease renewals, maintenance timing. |

Each profile links to its entity-level statements or planning comparison. Operational quantities, rates, and supporting commercial evidence are **not provided**. Descriptions are prompts for a possible finance review, not validated explanations of the supplied figures.

## 5. State and reversibility contract

| State | Lifetime | Reversal |
| --- | --- | --- |
| Supplied actual/budget/forecast fixtures | Bundled, read-only | Never edited by UI workflows. |
| Scope, reporting period, reporting scenario, workspace label, preferences | React session | Change selector/toggle, label undo, or confirmed full reset. |
| Applied planning preset | React session across screens | Undo/redo history bounded to 20 changes; reset-to-base is an ordinary reversible preset change. |
| Unapplied assumption text | Current planning screen | Edit, apply a valid preset, undo/reset, or leave the screen. |
| Import filename, source type, mapping, preview validation, current step | React session across screens | Undo last mapping edit, reset flow, undo the last flow reset, or confirmed full reset. |
| Inspection markers | React session across screens | Undo an individual marker or clear all. They never clear blockers. |
| Activity search text | React session | Clear the chip, clear filters, or full reset. Category filter is screen-local. |
| Excel proposed value | Current Excel context/screen | Bounded draft undo, restore fixture value, cancel review, or leave/change context. |
| Last workspace-label undo | Current Settings screen | Undo label change; full reset also restores the original fictional label. |

A page reload clears all React state. No localStorage, sessionStorage, IndexedDB, database, or server persistence is used. UI history is not audit history or financial version control.

## 6. Implementation map

### Existing files refined

- `src/App.tsx`: existing shell retained; session metadata/history, search keyboard behavior, focus management, mobile navigation, and full reset extended.
- `src/lib/workspace.ts`: typed session-only state and actions extended.
- `src/components/ui.tsx`: existing primitives retained; scoped source detail, focusable page headings, dynamic pinned dialog actions, and centralized app-name usage added.
- `src/components/TrendChart.tsx`: period-end values, explicit signed comparison context, and a direct variance-review action.
- `src/pages/Overview.tsx`: mini-trends, expense comparison tab, clickable variances, business profiles, and a follow-on review path.
- `src/pages/Statements.tsx`: keyboard tabs, clickable amounts/variances, missing-input recovery, planning and reporting handoffs.
- `src/pages/Planning.tsx`: reversible preset changes, semantic validation, sector profiles, and reporting handoff.
- `src/pages/Consolidation.tsx`: reversible inspection markers and source/activity handoffs; all financial blockers preserved.
- `src/pages/Imports.tsx`: retained filename-only state, selected-source feedback, reversible mapping/reset, progression guards, focused recovery, and Excel handoff.
- `src/pages/Excel.tsx`: availability simulation/retry, keyboard tabs, reversible draft values, explicit review and mock-activity handoff.
- `src/pages/Activity.tsx`: contextual filtering, richer fixed-entry detail, and related-workflow navigation.
- `src/pages/Settings.tsx`: live display preview, label undo, clearer reporting label, and keyboard help.
- `src/index.css`: imports the refinement layer after the existing design system.
- `vite.config.ts`: narrowly excludes known externally injected recording/view scripts from HTML output; existing plugins and configuration are retained.
- `scripts/smoke_test.py`: original regression suite retained; the mapping-error test now verifies guarded progression and recovery.
- `README.md`: updated state contract, navigation guidance, and test handoff.

### Focused additions

- `src/lib/reviewData.ts`: fictional sector profiles, import mapping metadata, and mock-entry workflow destinations.
- `src/lib/useUndoState.ts`: reusable bounded UI history.
- `src/components/Tabs.tsx`: semantic keyboard-operated tabs.
- `src/components/review.tsx`: variance investigation, business profiles, mini-trends, and contextual handoffs.
- `src/styles/refinements.css`: cohesive visual/readability refinements and styles for the added interactions; the original stylesheet is preserved.
- `scripts/journey_test.py`: complete connected journeys, reversibility, keyboard behavior, privacy boundaries, and responsive edge cases.
- `scripts/contrast_audit.py`: rendered-text sampling with a validated luminance fixture, explicit exclusions, saved evidence, and a failing exit when sampled text is below threshold.
- This design/handoff document.

The original financial fixture file `src/lib/data.ts`, package manifests, app entry-point identity, favicon, and `public/demo/synthetic-january-2026.csv` were not replaced or reset by this refinement.

## 7. Verification and refinement findings

### Commands actually run

| Command | Result |
| --- | --- |
| `npm run build` | Passed: TypeScript project build and Vite production bundle regenerated at `dist/index.html`. |
| `npm run lint` | Passed: zero errors and warnings. |
| `python scripts/smoke_test.py` | Passed: **90 regression checks**. |
| `python scripts/journey_test.py` | Passed: **143 end-to-end journey checks**. |
| `python scripts/contrast_audit.py` | Passed: **1,513 text samples across 22 states**, zero below the audit threshold. |

The two browser suites total **233 checks**. Both report zero browser runtime errors and zero external runtime requests. File-read instrumentation confirms no file-content APIs were called. Browser-storage checks confirm no localStorage or sessionStorage use.

Tested viewport sizes include **1440×900**, **1366×768**, **1024×900**, **390×844**, and **360×800**. All eight pages were checked for page-level horizontal overflow; data tables retain their own horizontal scrolling where appropriate.

### Issues found in the real rendered result and corrected

1. **External recording requests in the previous built HTML:** a clean browser inspection surfaced the hosting-injected recorder/CDN and page-view request. The build transform excludes those known injected scripts while preserving the local editor helper. The output HTML was checked directly, and the complete journeys then made zero external requests.
2. **Mobile handoff overflow:** the group-reporting handoff reached a document width of 409 px at a 390 px viewport. Its paired actions now wrap within a bounded container; normal and long-metadata paths pass at 390 and 360 px.
3. **Primary drawer actions below the scroll fold:** real screenshots showed the forward controls could be missed. They now render in the fixed dialog footer. The test suite checks that the primary action is visible without content scrolling on desktop and mobile.
4. **Low-contrast supporting text:** the rendered-state audit identified muted text on pale surfaces, including step labels, chart axes, workbook status, audit metadata, and readiness notes. Shared text tones were deepened without changing the navy/teal/warm-gray theme. The final audit includes drawers, mapping/error states, unavailable Excel, command search, and mobile views, not just the first screen.
5. **An asynchronous test-focus race:** mapping recovery intentionally focuses the newly mounted field on the next animation frame. The journey assertion now waits for that focus state rather than inspecting it before the frame has occurred. It still fails if focus never reaches the correct field.
6. **Unsupported workbook drop had no explicit feedback:** the unavailable path now produces an actionable explanation and clears when changing to the supported source type.

### Evidence and reproduction

The test harnesses need Python Playwright and Chromium, already present in this workspace. They serve the existing production bundle with a temporary local static-file server and shut it down in `finally`; no application backend was added.

- Core report: `artifacts/test-report.json`.
- Journey report: `artifacts/ui-upgrade/journey-report.json`.
- Contrast report: `artifacts/ui-upgrade/contrast-report.json`.
- Final command logs: `artifacts/ui-upgrade/smoke-final.log`, `journey-final.log`, and `contrast-final.log`.
- Baseline screenshots: `artifacts/ui-upgrade/before/`.
- Verified screenshots: `artifacts/ui-upgrade/after-*.png`, including overview, variance drawers, reporting review, import handoff, write confirmation, activity detail, and mobile views.
- `first-*.png` and overflow captures are inspection/iteration evidence, not the final UI state.

The text audit checks the rendered CSS colors/opacity of sampled text against its surfaces, using thresholds of 4.5:1 for ordinary text and 3:1 for large text. It excludes disabled controls, decorative separators, hidden text, and native option popups. It is a focused automated check, **not a full accessibility certification or legal/regulatory compliance claim**.

## 8. Handoff boundaries and known limitations

- This is still **not a production financial application**. There is no financial engine, backend, database, authentication, production encryption, or connected corporate system.
- No native Windows/Office add-in, workbook execution, actual write-back, or installable offline application is implemented. Local runtime requires a local Vite/static server and installed dependencies.
- CSV selection and validation are UI demonstrations. The file is not parsed. Mapping and reconciliation always use bundled synthetic rows.
- Inspection markers are not approval, resolution, consolidation, or audit events. Both reporting blockers remain present after every interaction.
- Cash, full balance-sheet/cash-flow inputs, ownership/control conclusions, and approved accounting policies remain unsupplied.
- Sector drivers are review prompts, not measured inputs or verified explanations.
- Fixed scenario previews are not an authoritative model. UI arithmetic is limited to presentation of synthetic integer amounts and display comparisons.
- The local build was verified without external runtime requests. The known hosting recorders are stripped by the Vite transform; this is not a general-purpose security product or a guarantee about arbitrary future hosting modifications.
- Tests use Chromium in the available Linux workspace. They do not replace native Windows/Excel validation, an assistive-technology review, cross-browser certification, or expert financial/legal review.
- The full-demo reset deliberately clears temporary metadata and undo histories after confirmation. No state is promised to survive reload.

These boundaries are intentional. The value of this deliverable is a coherent, navigable and reversible review experience that can be evaluated without implying that a real financial system has been built.
