# Per-Project Blueprint Packs Index (Atlas FP&A v4.0)

**Status:** Owner-approved Master Per-Project Documentation System (v4.0) · **Synchronized with:** `../docs/23-per-project-master-blueprint-v4.0.md` and `../../_project_brain/00`–`05`.

This directory breaks the monolithic FP&A architecture into **modular, standalone per-project packs**:
1. **Seven Engineering Sub-Project Blueprint Packs** (`PRJ-CORE` through `PRJ-DIST`) — each owning bounded runtimes, IPC schemas, invariants (`I01`–`I40`), security controls, and phase exit gates.
2. **One Multi-Project FP&A Workspace Isolation & Project P&L Spec** (`FPA-WORKSPACES`) — defining isolated per-client/per-deal Chart of Accounts namespaces, ERP profiles, WBS/CapEx/PoC accounting, and cross-project consolidation FX boundaries (`I37`–`I39`).

---

## 1. Seven Engineering Sub-Project Packs (`PRJ-CORE` – `PRJ-DIST`)

| Pack ID | Runtime / Binary | Primary Responsibility | Owned Invariants | Phases Unlocked | Pack Document |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `PRJ-CORE` | **Rust** (`fpa-core.exe`) | Sole SQLCipher writer, `Fixed128`/`BigInt` math, 100M+ Block-Hybrid Hyperblock, Project isolation & WBS/PoC engine | `I01`–`I09`, `I11`, `I12`, `I16`, `I17`, `I21`, `I22`, `I26`, `I27`, `I34`, `I35`, `I37`–`I39` | `P1`, `P3`, `P4` | [PRJ-CORE](./PRJ-CORE-rust-engine-and-vault.md) |
| `PRJ-IO` | **Go** (`fpa-io.exe`) | Top-12 ERP streaming ingestion (`CSV`/`XLSX`/`PARQUET`/`XML`/`JSON`), SCD2 CoA staging, `IMP-GL`/`IMP-SUB`, zstd backups | `I03`, `I04`, `I10`, `I13`–`I15`, `I23`, `I30`, `I33`, `I37` | `P2`, `P7` | [PRJ-IO](./PRJ-IO-go-universal-erp-worker.md) |
| `PRJ-FLOW` | **Elixir / BEAM** (`fpa-flow --start-epmd false`) | OTP close-calendar DAG workflows, approval sagas, canonical `K3` exception orchestration (zero TCP ports) | `I15`, `I18`, `I30` | `P5` | [PRJ-FLOW](./PRJ-FLOW-elixir-close-orchestrator.md) |
| `PRJ-DOCS` | **Java 25 `jlink`** (`fpa-docs.exe`, ~45 MB) | Apache POI SXSSF streaming OpenXML board packs preserving customer charts, macros, and conditional formatting | `I19`, `I24`, `I30` | `P6` | [PRJ-DOCS](./PRJ-DOCS-java-openxml-renderer.md) |
| `PRJ-XLL` | **Rust C-ABI `.xll`** (`fpa-xll.xll`) | Native Office 2021 64-bit Excel integration: read-only `=FPA.GET`, `#BLOCKED!` on `=FPA.SET`, 15-sig-digit guard, Command push | `I20`, `I28` | `P4`, `P6` | [PRJ-XLL](./PRJ-XLL-office-2021-excel-addin.md) |
| `PRJ-UI` | **TypeScript / React 19 / Tauri v2** (`Atlas FP&A`) | Desktop shell, Multi-Project Workspace Switcher, `Ctrl+K`, accessible grids, and pure `BigInt` reference parity oracle (`P0`) | `I25`, `I29`, `I31`, `I32`, `I36`, `I40` | `P0`, `P3`, `P7` | [PRJ-UI](./PRJ-UI-atlas-workbench-and-oracle.md) |
| `PRJ-DIST` | **WiX v4 / Win32 Job Objects** (`atlas-fpa-omni.msi`) | Windows 11 per-user installer, DPAPI key wrapping, process-tree cleanup, air-gap proof & SME UAT suite | `I21`, `I24`, `I32`, `I36`, `I40` | `P7` | [PRJ-DIST](./PRJ-DIST-windows-msi-security-qa.md) |

---

## 2. FP&A Business Workspace Isolation Pack

| Pack ID | Scope | Owned Invariants | Pack Document |
| :--- | :--- | :--- | :--- |
| `FPA-WORKSPACES` | Isolated multi-project FP&A workspaces (`PRJ-01`..`PRJ-04`), sealed Project CoA (`I37`), Cross-Project FX consolidation guard (`I38`), WBS/EAC/PoC Project P&L (`I39`) | `I37`, `I38`, `I39` | [FPA-WORKSPACES](./FPA-WORKSPACES-multi-project-isolation-and-pnl.md) |

---

## 3. Secondary Brain Pre-Flight Rule for Every Sub-Project Session

Before editing any sub-project or phase:
1. **READ**: `../../_project_brain/00_GOLDEN_RULES.md`, `../../_project_brain/04_ACTIVE_STATE_AND_TASKS.md`, and the target `PRJ-*` pack in this folder.
2. **VERIFY**: Run `npx --yes tsx --test frontend-builder/src/lib/domainRules.test.ts frontend-builder/src/lib/omniBlueprintEngine.test.ts` and inspect `atlas-fpa-v4.0-parity-vectors.json`.
3. **ACT**: Implement only contracts belonging to the active sub-project and phase gate; preserve strict zero-orphan coverage (`I31`, `I40`).
4. **MEMORIZE**: Update `_project_brain/01`–`05` and `../STATUS.md` with exact commands executed and honest unbuilt boundaries.
