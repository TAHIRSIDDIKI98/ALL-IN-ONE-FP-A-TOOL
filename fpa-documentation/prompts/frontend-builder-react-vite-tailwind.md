# Prompt for a frontend-building AI

Create a **high-fidelity, interactive frontend prototype** for a desktop FP&A application called **Atlas FP&A** (working title; easy to rename). This is the interface that finance professionals will use to navigate their financial data, budgets, forecasts and group consolidation. Build the prototype using **React + Vite + Tailwind CSS**.

## Important: prototype boundaries
- Build a frontend prototype only. Do **not** build or invent a real financial engine, backend, database, native Excel add-in, corporate integration, authentication or production encryption.
- Use **entirely fictional data**, fictional entities and fictional business names. No Al Ghurair branding, logos, real companies, corporate relationships, real client data or claims of endorsement. Keep a clearly visible `Prototype · Synthetic data` badge.
- Simulated buttons and workflows should work in the interface, but clearly say `Simulated` or `Demo only` when they would normally call real services. Never display a fake success message implying that an actual financial record, audit event, workbook or external system was changed.
- Do not claim accounting accuracy, regulatory compliance, secure encryption or completed consolidation. This prototype demonstrates how those workflows **could** look.
- Build only with React, Vite and Tailwind as the base. Use a small additional dependency only if genuinely needed and available. Do not rely on a backend, API key, online login, CDN, remote fonts, external images or network requests at runtime. Bundle any permitted assets locally. The app must work locally after dependencies are installed and the dev server is running.
- Desktop-first for Windows 11; a native Office 2021 64-bit Excel add-in and fully offline operation are eventual product requirements, **not implemented by this UI prototype**.

## Product context
The long-term product is an industry-agnostic FP&A tool, first focused on UAE-based group reporting across multiple businesses. One person works in a local workspace with multiple legal entities and business units. The product needs linked statements, planning, group consolidation, data imports, and native Excel integration, but legal scope and accounting policies still require expert approval.

## Design direction
Create a polished, premium **desktop financial workbench**, not a generic website or a wall of empty cards. It should feel credible for a senior group finance professional: calm, information-dense and readable. Use a light warm-gray canvas, white surfaces, deep navy text and sidebar, and a restrained teal/emerald accent. Use amber only for warnings and red sparingly for errors. Give the interface a clear visual identity through precise spacing, thoughtful typography and subtle borders; avoid gradients everywhere, oversized marketing headings and decorative clutter.

Design for a **1440 × 900** desktop first; remain usable down to 1024 px and adapt sensibly on smaller screens. A compact dark sidebar, top toolbar and consistent page headers should provide orientation. Use local/system fonts. Include clear keyboard focus, semantic controls, text labels, good contrast, table headers, screen-reader-friendly names, and status meaning that does not depend on color alone.

## Application layout and navigation
Create a persistent app shell:
- Left navigation: **Overview**, **Financial statements**, **Planning & scenarios**, **Group consolidation**, **Data imports**, **Excel integration**, **Audit & activity**, **Settings**. Show the active item clearly; each item must open a real prototype screen.
- Top bar: workspace selector, current entity/group scope, period selector, scenario selector, search control and an offline-status indicator. Label status `Offline demo`; do not claim that storage is encrypted or a backend is connected.
- A prominent, persistent `Prototype · Synthetic data` indicator; also note that production integrations are not connected.

## Screens and real interactions

### 1. Overview — make this the default, fully polished first view
Show a helpful executive landing screen for a fictional group:
- Heading with selected period, `AED`, scope and a short explanatory subtitle.
- Four compact KPI cards: revenue, operating expenses, operating result and cash, using the coherent dataset below. Each has a small actual-vs-plan label; values are mock data, not live calculations.
- A revenue/expense or actual/plan trend visualization, a variance table by business, and a small `Attention required` panel with realistic missing-input and Excel-disconnected statuses.
- Selectors and chart/table tabs must actually change the visible prototype state. Buttons should open the relevant screen or a clear demo dialog; no dead decorative buttons.
- Distinguish an **unadjusted management view** from a consolidated view. Never label a simple sum as consolidated.

### 2. Financial statements
Provide Income Statement, Balance Sheet and Cash Flow tabs with readable expandable-style line items or grouped rows. Show entity, period, currency, revision and `Demo data` context. Where mock data for a statement has not been supplied, use `Not provided` rather than fabricated values or zeros. Clicking an available row opens a source-detail panel with fictional provenance. Show empty, error or missing-data state when applicable.

### 3. Planning & scenarios
Show scenario selector and a side-by-side Actual / Budget / Forecast / Variance grid with units and months. Allow switching between predefined demo scenarios and editing a **local mock assumption**. Show a clear simulated preview and a `Reset demo` action. Avoid performing or claiming authoritative financial calculations; if using calculated demo values, label them illustrative and use predetermined consistent outputs. No fake saving to a ledger.

### 4. Group consolidation
Show a clear mock workflow: select reporting scope, review entity readiness, currencies/rates, intercompany items, adjustments and review. Include one fictional missing FX-rate issue and one fictional intercompany mismatch. Show explicit `Incomplete · not consolidated` status and prevent a fake final consolidation. Illustrate drill-down/drawer and source lineage. Do not imply ownership or accounting policy from names.

### 5. Data imports
Provide a mock source-import flow with file-type selection, mapping preview, validation/reconciliation and a visible confirm action. A test user can upload a **local synthetic CSV** for filename display only, or choose a provided example. Do not parse or store real data or claim a real import; confirmation opens a `Demo only — no financial data committed` dialog. Show that missing values, zero and validation errors are different.

### 6. Excel integration
Display `Not connected · prototype`, a visual mock of data pull and an explicit write-back preview that would require confirmation in the real product. Explain that the actual native Excel 2021 x64 add-in is **not built here**. No worksheet function may appear to write to financial records. Include a visible stale-data warning example.

### 7. Audit & activity
Show a fictional activity list with actor, action, timestamp, scope, revision and result. Mark entries as mock; clicking one opens detail. Do not claim events are immutable, tamper-proof, signed or persisted by a real audit system.

### 8. Settings
Organize appearance, reporting preferences and local workspace preferences. Any toggle must update the visible mock interface or be clearly disabled with a reason. Do not show pretend security controls as if encryption, key recovery or corporate SSO is actually implemented.

## Fictional dataset for a coherent default dashboard
Use AED for all values. Default Jan 2026, actual, fictional groups and operating measures only:

| Business | Revenue | Operating expenses | Operating result |
|---|---:|---:|---:|
| Synthetic Packaging | 1,000 | 750 | 250 |
| Synthetic Metals | 1,600 | 1,300 | 300 |
| Synthetic Property | 500 | 200 | 300 |
| **Unadjusted management total** | **3,100** | **2,250** | **850** |

Display units clearly, e.g. `AED thousands`, and use the same units everywhere. Show **cash as Not provided** unless adding a separately labeled fictional cash amount with a clear source. Do not call operating result EBITDA unless the component definition is approved. No intercompany assumption or FX conversion should be silently inferred. If you add a budget or trend, make it explicitly fictional and internally consistent, not connected to real data.

## Interaction and technical expectations
- Functional navigation, selectors, tabs, drawers/dialogs, a local-only demo scenario edit, mock import, mock Excel write preview, and reset. Use React state; optional browser localStorage is **not encrypted** and must be labeled demo-only. Do not store uploaded file contents or real data.
- Create reusable layout, table, badge, card and dialog components; keep mock data separate from UI. No hardcoded backend endpoints, secrets or cloud calls. Avoid financial arithmetic with JavaScript floating-point for authoritative values; this prototype has none.
- Implement loading, empty, missing and error displays, including clear `Not provided` vs `0`. Avoid hover-only access to essential controls.
- Implement responsive layout, accessible labels and meaningful focus states. Charts must include textual values or an accessible table alternative.
- Provide a README explaining setup, demo interactions, offline-runtime assumptions, limitations and that this is **not a production application**. If you run the build, report exact command and result; if not, say not run.

## Delivery
Create the project in the available workspace. Start the Vite preview if your environment supports it, binding to the required preview host. Present the running UI and source files. Finish with a concise screen inventory, what is interactive, what is simulated, and any known limitations. Do not ask for real corporate data. Prioritize a cohesive, finished experience over placeholder pages.
