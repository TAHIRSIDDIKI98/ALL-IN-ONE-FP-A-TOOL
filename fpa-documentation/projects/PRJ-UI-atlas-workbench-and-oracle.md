# PRJ-UI — Atlas FP&A Desktop Workbench & TypeScript Reference Oracle

**Sub-Project ID:** `PRJ-UI` · **Runtime:** React 19 + TypeScript 5.8 + Vite 7 + Tailwind v4 (+ Tauri v2 WebView2 on Windows) · **Phases Unlocked:** `P0` (`Verified`), `P3`, `P7`

---

## 1. Identity & Ownership Boundary

`PRJ-UI` is the presentation workbench (`Atlas FP&A`) and **Phase P0 Pure TypeScript `BigInt` Reference Oracle**.

- **Browser / Prototype Rule (`I29`)**: Zero `localStorage`/`sessionStorage`, zero `File.text()`/`FileReader` uploads, zero outbound HTTP requests (`I24`), and explicit `Prototype · Synthetic data` / `Offline demo` status disclosure (`I32`).
- **Tauri Production Rule**: On Windows 11 desktop builds (`P7`), TypeScript performs **zero authoritative accounting math**; all mutations dispatch via typed IPC commands to `PRJ-CORE`. In Phase `P0` (active in `frontend-builder/`), pure modules `domainRules.ts` and `omniBlueprintEngine.ts` implement exact `BigInt` scaled-integer & FIPS 180-4 SHA-256 reference logic audited via `node:test`.

---

## 2. Active Workbench Modules & Zero-Orphan Rule (`I31`)

Every engine rule implemented in `PRJ-UI` is actively mounted in the 8 workbench screens and indexed via `Ctrl+K`:
- **Overview**: 8 UAE conglomerate sector templates + 10 global industry blueprint packs (`BP-01`–`BP-10`).
- **Statements**: Multi-period `FLOW_SUM` / `STOCK_CLOSING_LAST` / `RATIO_OF_SUMS` + Kahn cyclic DAG blocker (`I08`, `I09`, `I27`).
- **Planning**: Actual/Budget/Forecast grid, UAE VAT/CT previews (`U-02`, `U-03`), Largest-Remainder `I05` allocator, 100M+ Block-Hybrid estimator, One-Stop FP&A Replacement Suite (`I34`, `I35`), and **Multi-Project FP&A Workspace Hub (`PRJ-01`..`PRJ-04`, `I37`–`I39`)**.
- **Consolidation**: `CONS-001`..`009` walkthrough + Golden 80/20 NCI & `T-AG-01` dividend boundary.
- **Imports**: Source-scoped `IMP-GL` vs `IMP-SUB` gate (`OQ-025`/`K2`/`K3`) + Top-12 Universal ERP Mapper (`I33`).
- **Excel**: `=FPA.GET` / `=FPA.SET` / 15-sig-digit & Command idempotency lab (`I20`, `I28`).
- **Activity**: Mock ledger + live FIPS 180-4 SHA-256 5-link tamper verifier (`I22`).
- **Settings**: 5-language contract toggles (`I30`), `atlas-fpa-v4.0-parity-vectors.json` exporter, 40-invariant live matrix (`I01`–`I40`), **8-Phase Execution Roadmap (`I36`)**, and **7 Engineering Sub-Project Blueprint Explorer (`I40`)**.

---

## 3. Owned Invariants

`PRJ-UI` enforces: `I25`, `I29`, `I31`, `I32`, `I36`, `I40`.

---

## 4. Phase Exit Gate & Verification Command

- **Phase P0 Gate**: `npx --yes tsx --test frontend-builder/src/lib/domainRules.test.ts frontend-builder/src/lib/omniBlueprintEngine.test.ts && npm run build && npm run lint`
