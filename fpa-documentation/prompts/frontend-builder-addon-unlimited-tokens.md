# Add-on prompt for the frontend-building AI

Paste this **after the original frontend prompt**, into the same session where you are already building the prototype.

---

Continue from the existing FP&A frontend prototype. You have a generous token budget: use it to **think deeply, review, implement, inspect and refine**, rather than stopping at a quick visual mockup. Tokens are not a substitute for running actual checks. This is an add-on to the previous prompt, not permission to change its boundaries.

## 1. Preserve the work already in progress
- First inspect the actual project, current UI, existing files, scripts, dependencies and repo instructions. Continue and improve the existing prototype. Do not start a competing project, wipe folders, reset the repo or replace existing work without a real reason and explicit approval.
- Re-read the original frontend prompt. Respect its synthetic-data, offline-runtime and UI-only limits. React + Vite + Tailwind are for this prototype; do not treat them as proof of an approved production stack.
- Do not import confidential company data, claim corporate endorsement, or imply that a frontend demo is a functioning accounting, audit, security or Excel system. Do not build a backend or connect external services.

## 2. Think like an experienced group finance user
Before coding, work through the daily journeys and document the results briefly in `docs/UI_DESIGN_NOTES.md` (create the folder if needed):
1. Morning overview → identify a variance → open the underlying business or statement → inspect the explanation and source.
2. Compare budget vs actual → inspect a business driver → edit a **demo** assumption → preview the effect → cancel or reset.
3. Review group reporting readiness → locate missing exchange rates / intercompany mismatches → see what would be needed to resolve them. Never label incomplete data as consolidated.
4. Choose a synthetic CSV example → inspect mapping and validation → view a simulated confirmation that commits nothing.
5. Inspect the Excel integration status → see a stale-data warning → review a mock write-back preview without creating a real workbook change.
6. Review a mock activity entry and navigate back to its related demo context.

For each journey list user goal, screens, steps, what changes visibly, empty/error/stale states and limitations. Keep the notes factual: planned, implemented and tested must be distinct.

## 3. Build depth across the screens
Preserve the original navigation and make every screen genuinely useful as a **prototype**, not a blank placeholder:
- **Overview:** KPI cards, clear reporting scope, actual-vs-plan comparison, trend view, business variance table, useful attention items and clickable drill-down.
- **Statements:** income statement, balance sheet and cash flow navigation; separate entity vs group contexts, row detail and honest `Not provided` values.
- **Planning:** Actual/Budget/Forecast comparisons, selectable scenarios, driver assumption details, reversible local demo edits and a visible `Simulated` indicator.
- **Consolidation:** entity readiness, control/ownership as fictional placeholders, currency/FX status, intercompany matching, proposed adjustments and a clear incomplete/blocked result. A management sum is not a consolidated result.
- **Imports:** sample CSV selection, mapping preview, row-validation feedback, reconciliation and explicit confirmation that nothing has been committed. Do not execute macros, parse uploaded confidential files or send data out.
- **Excel:** disconnected status, conceptual data-pull preview, stale revision example and explicit simulated write-back approval. Do not imply a native XLL exists.
- **Audit:** filterable mock activity, context/revision and detail view. Do not claim immutable, signed or production-grade audit.
- **Settings:** useful local demo preferences, offline explanation and disabled/unavailable production controls with clear reasons. Do not claim real encryption or key recovery.

Add a small industry/business selection experience covering fictional examples of manufacturing/packaging, metals, foods, real estate and property management, development, mobility, infrastructure and investments. Use sector-specific **labels and illustrative drivers** such as volume, yield, occupancy, project cost or fleet utilization, but do not present a template as a complete sector engine or fabricate legal ownership. Keep all data fictional and amounts/unit conventions consistent.

## 4. Make interactions deliberate
- Every enabled control must do something appropriate: navigate, filter, open details, change demo-only state or explain a limitation. Disable unavailable actions with readable reasons. Do not display false “success” for real writes.
- Provide believable, coherent states: loading, empty, no results, missing input, invalid value, error, stale revision, disabled service, partial scope and confirmation/cancel. Distinguish missing, zero and not applicable in text.
- Use the fictional baseline in the original prompt consistently. Label management sums, units, currency, period, scope and scenario. Any additional trend/budget numbers are invented demo data; keep them internally consistent. Never call operating result EBITDA unless a definition is approved.
- Preserve unsaved demo changes when moving between screens where sensible; provide clear reset and confirmation. If using browser localStorage, describe it as unencrypted **demo-only** storage and do not store uploaded file contents.
- Use predetermined exact display strings or otherwise prevent unsafe floating-point behavior from being represented as authoritative finance. UI mock computations are illustrative only.

## 5. Design system, accessibility and practical polish
- Build reusable shell, sidebar, page header, cards, status badges, tables, filters, tabs, drawers, dialogs, empty states and form controls. Use clear visual hierarchy, compact financial tables, alignment of numbers, readable units and a restrained navy/teal palette.
- Focus on desktop 1440×900 first, then verify 1024px and smaller screens; avoid horizontal page overflow. Tables may scroll inside a labeled container. Provide readable chart labels and table/text equivalents.
- Use semantic HTML, associated labels, visible focus, sensible keyboard order, Escape to close overlays, focus restoration, sufficient color contrast and non-color status text. Do not claim WCAG certification without a real assessment.
- Use system or locally bundled fonts/icons only. No runtime CDN, remote images, online account, telemetry or API dependency. Preserve honest offline limitations: the development dependency installation may require network, while the built UI must not require a network to render.

## 6. Verify instead of guessing
Use available tools and time to inspect the actual app, fix problems and repeat. Review scripts and dependencies before running them; do not execute arbitrary fetched installers.
- Run the actual build and any existing lint/test commands where available; report command and result. If something cannot be run, mark it not run and explain why. Do not add a fake test result.
- If a browser/preview or screenshot tools are available, inspect the real UI at multiple viewport sizes. Test sidebar navigation, filters, dialogs, keyboard focus, scenario reset, import/Excel demo boundaries, missing data and no network requests during normal runtime. If those tools are unavailable, explicitly say so.
- Check the synthetic totals and displayed units; inspect for broken links, placeholder text, dead controls, console errors and accidental claims of real functionality. Fix issues and rerun appropriate checks.
- Be careful not to install unnecessary packages or leak secrets/corporate information. Do not claim a security audit, Windows/Office test or finance review unless it actually happened.

## 7. Documentation and handoff
- Write/update a concise project README with setup, commands, what works, what is simulated, offline limits, accessibility/testing evidence, known gaps and repository structure. List exact dependencies from the actual manifest/lockfile; do not invent versions.
- Add `docs/UI_FEATURE_MATRIX.md` mapping screens and interactions to `implemented`, `partial`, `not implemented`, with a short evidence/limitation note. Do not claim the long-term FP&A product features are complete.
- If `_project_brain/` and root `AGENTS.md` already exist, read and respect them; update only the relevant active-state/architecture notes with **actual evidence**, without changing confirmed financial rules or approving technology decisions. If they do not exist, do not invent a Brain or claim to have updated it: instead leave a clear handoff in the README.
- Do not commit, push, delete files, or overwrite unrelated work without explicit permission. Present a running preview if your environment supports it and give the user: screens completed, interactions tested, exact checks/results, known gaps, files changed and next suggested UI-only improvements.

Work carefully and extensively within these bounds. Favor a cohesive, genuinely navigable and honest prototype over an oversized list of nonfunctional features.
