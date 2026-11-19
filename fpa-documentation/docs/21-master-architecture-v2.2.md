# Atlas FP&A Omni — Master Architectural & Implementation Specification (v2.2)

**Status:** Owner-approved Master Architecture v2.2 & interactive TS/React reference workbench; native Windows 11 multi-runtime binaries (`fpa-core.exe`, `fpa-io.exe`, `fpa-flow`, `fpa-docs.exe`, `fpa-xll.xll`) remain unbuilt in the Linux UI environment.  
**Last updated:** 18 November 2026  
**Prerequisite reading:** `00_GOLDEN_RULES.md`, `docs/12-feedback-adjudication.md`, `docs/19-consolidation-scope.md`.

---

## 1. Confirmed V1 Scope & Architectural Decisions

Following owner clarification and approval of **Master Plan v2.2**:

1. **Industry & Consolidation Scope:** All **10 global industry blueprint packs** (`BP-01`–`BP-10`) launch simultaneously in V1 alongside the **8 UAE conglomerate sectors** (`Packaging`, `Metals`, `Property`, `Foods`, `Development`, `Mobility`, `Infrastructure`, `Investments`) and mandatory true group consolidation (no unadjusted sums masquerading as consolidated statements).
2. **Contract-Bounded 5-Language Windows 11 Offline Architecture (with Rust Fallback Toggles):**
   - **Rust (`fpa-core.exe`, `fpa-xll.xll`)**: **Mandatory central authority** — sole authoritative writer to encrypted local storage (`SQLCipher` AES-256 + Windows DPAPI), `Fixed128` (`BigInt` scaled-integer in TS oracle) calculation engine, 100M+ cell Block-Hybrid Hyperblock, hash-chained append-only audit ledger, and native 64-bit Excel XLL add-in (`FPA.GET` read-only UDF + atomic signed Command write-back). Cannot be disabled.
   - **TypeScript (`Atlas FP&A`, React 19 + Vite 7 + Tailwind v4)**: Desktop UI shell (WebView2 / localhost Vite preview), Cmd/Ctrl+K navigation, reversible local staging drafts, non-authoritative visual formatting (`domainRules.ts` & `omniBlueprintEngine.ts` serve as pure reference oracles in the browser prototype).
   - **Go (`fpa-io.exe`)**: Stateless CSV / Apache Arrow / Parquet streaming pre-parser, signed control-total verifier (`IMP-GL` vs `IMP-SUB`), and zstd encrypted backup snapshot bundler over framed NDJSON/IPC. **Rust Fallback Toggle:** `fpa-core::io`.
   - **Elixir / BEAM (`fpa-flow`)**: Must boot with `--start-epmd false -elixir ansi_enabled false` (stdin/stdout length-prefixed JSON-RPC/ETF, zero loopback ports or Windows Firewall triggers) to orchestrate close-calendar DAG workflows, approval sagas, and bounded retries. **Rust Fallback Toggle:** Rust sequential state-machine executor.
   - **Java 25 trimmed `jlink` runtime (`fpa-docs.exe`, ~45 MB offline)**: Apache POI `SXSSF` streaming OpenXML engine preserving customer templates, charts, named ranges, and conditional styling cleanly without a system JRE. **Rust Fallback Toggle:** `rust_xlsxwriter` basic grid exporter.
3. **Target Scale & Offline Model:** Single-user offline Windows 11 desktop V1 targeting **100M+ populated cells** inside an active **~2.2 GB RAM** budget via adaptive `4,096`-cell Block-Hybrid representation (`EMPTY`, `CONSTANT`, `SPARSE`, `DICT`, `DENSE`) with `ChaCha20-Poly1305` per-page encrypted mmap spill for cold blocks.
4. **Native Excel Integration (P0):** Office 2021 64-bit native `.xll` add-in strictly enforcing read-only `=FPA.GET(...)` worksheet formulas (no side-effecting `=FPA.SET()`) paired with explicit, idempotent signed Command push batches.

---

## 2. Forensic Post-Mortem of Prior Failed Versions & Mandatory Countermeasures

Architectural safeguards directly derived from inspecting the four preceding repository attempts (`TAHIRSIDDIKI98/fp-A-betterversion`, `TAHIRSIDDIKI98/fpa`, `TAHIRSIDDIKI98/FPA-modular`, `TAHIRSIDDIKI98/finalFPA`):

| Prior Repo | Root Failure Mode Observed | v2.2 Structural Countermeasure Implemented |
| :--- | :--- | :--- |
| **`fp-A-betterversion`** | **Orphaned Engine Syndrome:** 82/180 engines (`45.5%`) were unwired dead files; only `30.1%` (`320/1,063`) of modules used decimal money; 48 Zustand stores bypassed a 35-table SQLite schema into 1 KV JSON blob; Vitest timed out at `1,800s`; `tauriRuntime.ts` blocked browser verification. | Every shipped domain module (`domainRules.ts`, `omniBlueprintEngine.ts`) is wired directly to active React UI cards (`BlueprintStudioCard`, `HyperblockScaleCard`, `SubLedgerGateCard`, `PolyglotArchitectureCard`), covered by `<1s` `node:test` (`tsx --test`), uses `100% BigInt` scaled integers, and never blocks standard browser verification. |
| **`fpa` (OneFP&A)** | **Unverified Vapor & Formula Warnings:** 27k-LOC Rust authored without running `cargo`; mock-only MVP commands; in-memory waivers skipped audit logs; `132` formula/alert warnings across 12 industry packs; dual lockfiles. | All **10 industry blueprint packs (`BP-01`–`BP-10`)** pass an executable self-validator guaranteeing `0` orphan dependencies, `0` missing formulas, `0` stock-sum violations (`I08`), and `0` ratio-sum violations (`I09`). |
| **`finalFPA`** | **Synthetic Data & Ingestion Defects:** False `rc2` readiness while acceptance exited `1` (`11/32` recall, `20,691` extra false alerts): (a) random independent Actual vs. Budget (`K2`); (b) future dates (`2026-12-27` vs `2026-11-12` `EXC-011`); (c) unconditional `debit == credit` rejected `0/499` bank & `0/399` payroll rows (`OQ-025`); (d) diverging exception finding keys (`K3`). | **Source-scoped ingestion gate (`IMP-GL` vs `IMP-SUB`)** restricts `Dr == Cr` to GL Trial Balances and validates signed sub-ledgers via `rowCount` + signed control total + fiscal window (`SubLedgerGateCard`), paired with a single canonical 5-part key `RULE_ID\|ENTITY\|ACCOUNT\|PERIOD\|GRAIN`. |
| **`FPA-modular` (Attempt #5)** | **Spec-Only Paralysis:** `1,024` markdown regex tests and `0/30` WIs completed at `WI-0001`. | Every vertical slice pairs concise specification updates with live executable TypeScript reference code, unit tests, and verified interactive UI. |

---

## 3. Global 10-Industry Declarative Blueprint Matrix (`BP-01`–`BP-10`)

Implemented in `frontend-builder/src/lib/omniBlueprintEngine.ts` and exposed interactively in `BlueprintStudioCard.tsx` (`Overview`):

| Code | Industry Pack | Core Declarative BigInt Metrics & Aggregation Guards | Alignment |
| :--- | :--- | :--- | :--- |
| `BP-01` | SaaS & Subscription Tech | `Closing ARR` (`STOCK_CLOSING_LAST`), `NRR %` (`RATIO_OF_SUMS`), `GRR %` | Global Core |
| `BP-02` | Professional Services | `Billable Utilization %`, `Realized Rate`, `Engagement Margin %` | Global Core |
| `BP-03` | Manufacturing & Industrial | `First-Pass Yield %`, `Cost Variance`, `Unit Conversion Cost` | ENT-01 Packaging / ENT-02 Metals |
| `BP-04` | Retail, CPG & E-Commerce | `Gross Margin`, `Gross Margin %`, `GMROI` (`STOCK_CLOSING_LAST` inventory) | TPL-04 Foods Distribution |
| `BP-05` | Healthcare & Pharma | `Net Patient Revenue`, `Realization %`, `ALOS Days` | Global Core |
| `BP-06` | Construction & AEC | `PoC %`, `Earned Revenue`, `Net CIE/BIE` | TPL-07 Infrastructure |
| `BP-07` | Real Estate & Hospitality | `Area-Weighted Occupancy` (`T-AG-07` `27.5%`), `NOI`, `NOI Margin %` | ENT-03 Property / TPL-05 Development |
| `BP-08` | Banking, FinTech & Insurance | `NII`, `Annualized NIM %`, `CET1 Ratio %` | TPL-08 Investments Capital Perimeter |
| `BP-09` | Energy, Mining & Utilities | `Capacity Factor %`, `Unit Lifting Cost`, `Asset EBITDAX` | Global Core |
| `BP-10` | Nonprofit & Public Sector | `Closing Restricted Net Assets`, `Program Expense Ratio %` | Global Core |

---

## 4. Blocking Invariants (`I01`–`I32`)

All 32 invariants are executed and inspectable in `PolyglotArchitectureCard.tsx` (`Settings`) and unit-tested in `omniBlueprintEngine.test.ts`:

- **Tier 1 (`I01`–`I10`): Numeric & Accounting Core** — Zero `f64` in money/rates (`I01`), deterministic half-even rounding & `U-02`/`U-03` (`I02`), `GL Dr==Cr` scoped vs. `IMP-SUB` (`I03`), missing != zero (`I04`), Largest-Remainder exact-sum allocator rejecting negative/zero weights (`I05`), locked period/SCD2 immutability (`I06`), explicit FX with no invented fallback (`I07`), `CLOSING_LAST` on stocks (`I08`), `RATIO_OF_SUMS` / `T-AG-07` (`I09`), explicit physical unit conversion / `T-AG-08` (`I10`).
- **Tier 2 (`I11`–`I20`): Consolidation, Ingestion & Polyglot Contracts** — IC matching `CONS-004` (`I11`), ownership & dividend separation `CONS-001` / `T-AG-01` (`I12`), `IMP-SUB` fixing `OQ-025` (`I13`), fiscal-window quarantine fixing `K2` (`I14`), canonical 5-part key `K3` (`I15`), 0 orphan formulas across all 10 packs (`I16`), Rust sole writer (`I17`), Elixir `--start-epmd false` (`I18`), Java 25 `jlink` / Rust fallback (`I19`), Excel XLL `FPA.GET` read-only + 15-digit guard + `#BLOCKED!` on `FPA.SET` (`I20`, live oracle in `ExcelXllContractCard`).
- **Tier 3 (`I21`–`I32`): Security, 100M+ Scale & Delivery Hygiene** — SQLCipher AES-256 contract (`I21`), FIPS 180-4 SHA-256 hash-chained audit oracle (`I22`, live tamper lab in `AuditChainCard`), snapshot dry-run (`I23`), 100% offline Windows 11 contract (`I24`), reversible bounded undo/redo (`I25`), 100M+ cell Block-Hybrid + encrypted mmap spill check (`I26`), Kahn's deterministic acyclic DAG sort blocking cycles (`I27`, live lab in `StatementPolicyCard`), command idempotency `409`/`412` (`I28`, live ledger in `ExcelXllContractCard`), zero stealth browser persistence or file reads (`I29`), fallback parity (`I30`), zero-orphan engine wiring (`I31`), and strict honesty boundaries (`I32`).

---

## 5. Honest Verification Boundaries (Linux Sandbox vs. Windows 11 Target)

- **Verified right now in AI Studio (`frontend-builder/`):** Pure TypeScript `BigInt` & synchronous FIPS 180-4 SHA-256 reference oracle (`domainRules.ts` + `omniBlueprintEngine.ts` + machine-readable `generateGoldenContractBundle()` parity export), `14/14` `node:test` suites (`npx --yes tsx --test`), `tsc -b && vite build`, `eslint .`, and live headless Chromium UI journeys + WCAG contrast audit across all 8 screens on `1440x900` and `390x844`.
- **Specified / Not Yet Built or Tested:** Native Windows 11 binaries (`fpa-core.exe`, `fpa-io.exe`, `fpa-flow`, `fpa-docs.exe`, `fpa-xll.xll`), SQLCipher native storage, encrypted mmap spill runtime, and Office 2021 64-bit Excel `.xll` C ABI host integration.
