# 23 — Per-Project Master Architecture, Modular Blueprint Packs & Multi-Project FP&A (v4.0)

**Status:** Owner-approved Master Per-Project Specification (v4.0), building cleanly on `docs/21-master-architecture-v2.2.md` and `docs/22-master-roadmap-and-erp-blueprint-v3.0.md`. Synchronized with `_project_brain/00`–`05`, `../projects/*`, and the pure-`BigInt` TypeScript reference oracle in `frontend-builder/src/lib/omniBlueprintEngine.ts`.

---

## 1. Three-Dimensional Per-Project System

Version 4.0 eliminates monolithic documentation and single-model blind spots by structuring Atlas FP&A across three synchronized per-project dimensions:

1. **Dimension A — Seven Modular Engineering Sub-Project Blueprint Packs (`../projects/PRJ-*`)**:
   - `PRJ-CORE` (Rust `fpa-core.exe`), `PRJ-IO` (Go `fpa-io.exe`), `PRJ-FLOW` (Elixir `fpa-flow --start-epmd false`), `PRJ-DOCS` (Java 25 `fpa-docs.exe`), `PRJ-XLL` (Rust C-ABI `fpa-xll.xll`), `PRJ-UI` (React 19 / TypeScript / Tauri v2 `Atlas FP&A`), and `PRJ-DIST` (WiX v4 MSI, Win32 Job Objects & DPAPI).
   - Every blocking invariant (`I01`–`I40`) is assigned to at least one Engineering Sub-Project pack (`0` orphan invariants, verified programmatically by `I40`).
2. **Dimension B — Multi-Project FP&A Workspaces, Isolated CoA & Project P&L (`I37`–`I39`)**:
   - Four isolated business workspaces (`PRJ-01` Aster Vale Group `USD`, `PRJ-02` Al-Noor Commercial Tower WBS `AED`, `PRJ-03` Atlas Cloud SaaS Expansion `EUR`, `PRJ-04` Gulf Packaging Line 4 CapEx `GBP`), each sealed inside its own Chart of Accounts namespace (`I37`), ERP adapter profile, WBS milestone schedule, EAC/ETC calculation, Percentage-of-Completion (`PoC %`) revenue recognition, and explicit multi-currency FX consolidation boundary (`I38`, `I39`).
3. **Dimension C — Per-Phase Execution Kits (`P0`–`P7`) & Secondary Brain Sync (`I36`, `I40`)**:
   - Every build phase (`P0` verified reference oracle through `P7` offline Windows 11 installer certification) explicitly binds to its participating Engineering Sub-Projects, blocking parity invariants in `atlas-fpa-v4.0-parity-vectors.json`, deterministic exit gate command, and mandatory `_project_brain/00`–`05` update rules.

---

## 2. Expanded 40 Blocking Invariants (`I01` – `I40`)

- `I01`–`I32`: Verified Master Architecture v2.2 numeric, consolidation, Hyperblock scale, ingestion (`OQ-025`/`K2`/`K3`), SHA-256 hash chain, and Excel XLL invariants.
- `I33`: Universal Top-12 ERP Adapter Catalog (`ERP-01`–`ERP-12`) & SCD2 CoA normalizer with `QUARANTINED_UNMAPPED_COA`.
- `I34`: Workforce & UAE Federal Decree-Law No. 33 Art. 51 End-of-Service Gratuity (`21d`/`30d` tranches + 24-month cap) & CapEx NBV roll-forward (`STOCK_CLOSING_LAST`).
- `I35`: 13-Week Direct Cash Flow Revolver/DSCR guard & zero-delta `PVM` + FX Variance Bridge.
- `I36`: 8 Gated Vertical Build Phases (`P0`–`P7`) & Secondary Brain synchronization discipline.
- **`I37`**: **Project CoA & Ledger Isolation Firewall** — blocks cross-project posting or account bleed across sealed FP&A workspaces (`CROSS_PROJECT_COA_ISOLATION_VIOLATION`).
- **`I38`**: **Cross-Project Multi-Currency Consolidation Guard** — quarantines projects missing an explicit FX rate (`PARTIAL_EXCLUDED_MISSING_FX`) rather than defaulting to `0` or summing mixed currencies `1:1`.
- **`I39`**: **Exact `BigInt` WBS, EAC, PoC % & Project P&L Conservation** — child WBS actuals and ETC sum identically (`0n` delta) to Project P&L EAC, capped `PoC %`, Earned Revenue, and Recognized Gross Profit.
- **`I40`**: **Per-Project Sub-Project Pack & Phase Traceability** — `0` orphan invariants across all 7 Engineering Sub-Projects (`PRJ-CORE`..`PRJ-DIST`), all 8 phases (`P0`–`P7`), and `atlas-fpa-v4.0-parity-vectors.json`.

---

## 3. Honest Implementation Status (`I32`)

- **Verified in `P0` Reference Workbench (`frontend-builder/`)**: All 40 invariants (`I01`–`I40`), all 4 isolated FP&A Workspaces, all 7 Engineering Sub-Project registries, all 10 Global Industry Packs, and Top-12 ERP normalization pass in `BigInt` unit tests (`tsx --test`) and interactive browser verification.
- **Unbuilt Native Windows 11 Runtimes (`P1`–`P7`)**: Compiled executables (`fpa-core.exe`, `fpa-io.exe`, `fpa-flow`, `fpa-docs.exe`, `fpa-xll.xll`), `SQLCipher` AES-256 disk persistence, WiX MSI packaging, and live Office 2021 64-bit Excel host execution remain contract-specified for Windows native execution.
