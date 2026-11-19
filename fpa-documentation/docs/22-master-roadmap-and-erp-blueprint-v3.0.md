# 22 — Master Zero-Compromise Execution Roadmap & Universal ERP Blueprint (v3.0)

**Status:** Owner-approved Master Roadmap & Universal ERP Blueprint (v3.0). Synchronized with `_project_brain/00_GOLDEN_RULES.md` through `_project_brain/05_DECISION_LOG.md` and interactive reference oracle `frontend-builder/src/lib/omniBlueprintEngine.ts`.

---

## 1. Executive Mandate & Scope Boundaries

1. **Zero-Compromise Precision (`I01`–`I07`)**: Every currency, rate, headcount, gratuity, depreciation, cash-flow, and variance figure is computed in `100% BigInt` / `i128` scaled integers (`10^2` fils for currency, `10^4` basis points for percentages, `10^8` for FX rates). IEEE-754 `f32`/`f64` floats are strictly forbidden in financial state.
2. **Universal Top-12 ERP Adapter Catalog (`I33`)**: Out-of-the-box deterministic normalization across 12 enterprise and mid-market ERPs spanning `CSV`, `XLSX`, `PARQUET`, `XML`, and `JSON` with an SCD2 Canonical Chart of Accounts (`CoA`) mapper and source-scoped `IMP-GL` vs `IMP-SUB` validation gates.
3. **Complete One-Stop FP&A Replacement Matrix (`I34`, `I35`)**: Replaces disconnected spreadsheets, legacy EPM planning cubes, financial consolidation tools, workforce gratuity trackers, CapEx schedules, and 13-week treasury cash models inside one coherent contract.
4. **8 Gated Vertical Build Phases (`P0`–`P7`, `I36`)**: Enforces the repository's 6-file **Secondary Brain** operating protocol (`READ → VERIFY → ACT → MEMORIZE`) and cross-language golden JSON parity vectors (`atlas-fpa-v3.0-parity-vectors.json`) at every phase boundary.
5. **Honest Sandbox vs Windows 11 Production Boundary (`I32`)**: All 36 invariants (`I01`–`I36`) execute and pass inside the pure-TypeScript reference oracle and automated unit tests (`frontend-builder/src/lib/omniBlueprintEngine.test.ts`). Native Windows 11 binaries (`fpa-core.exe`, `fpa-io.exe`, `fpa-flow`, `fpa-docs.exe`, `fpa-xll.xll`), SQLCipher disk persistence, and Office 2021 x64 host integration are contract-specified for Phases `P1`–`P7` and remain unbuilt in the Linux browser preview.

---

## 2. Universal Top-12 ERP Adapter Catalog & 6-Stage Ingestion Pipeline (`I33`)

### 2.1 The 6-Stage Go (`fpa-io.exe`) + Rust (`fpa-core.exe`) Ingestion Pipeline

| Stage | Name | Authority | Deterministic Rule |
| :--- | :--- | :--- | :--- |
| **Stage 1** | Physical Stream & SHA-256 Manifest | Go (`fpa-io.exe`) / Rust fallback | Computes FIPS 180-4 SHA-256 digest over raw bytes (`CSV`, `XLSX`, `PARQUET`, `XML`, `JSON`) before parsing. |
| **Stage 2** | Dialect & Sign Normalization | Go (`fpa-io.exe`) | Normalizes SAP `SHKZG` (`S`/`H` & trailing minus `1250000.00-`), TallyPrime lakh formatting (`2,50,000.00 Dr`/`Cr`), and signed `DR - CR` columns into exact `i128` (`10^2` fils). |
| **Stage 3** | SCD2 Canonical CoA & Dimension Lookup | Rust (`fpa-core.exe`) | Maps native ERP account keys (`RACCT`, Flexfields, `<LEDGERNAME>`) to canonical CoA IDs effective on the posting date. Unmapped codes route to `QUARANTINED_UNMAPPED_COA`. |
| **Stage 4** | Source-Scoped Gate (`IMP-GL` vs `IMP-SUB`) | Rust (`fpa-core.exe`) | General Ledger batches enforce `SUM(Debits) == SUM(Credits)` (`IMP-GL`). Sub-ledger batches (`BANK_SUBLEDGER`, `PAYROLL_REGISTER`, `PROPERTY_RENT_ROLL`) enforce control-total & positive-amount checks (`IMP-SUB`) without false zero-sum rejection (`OQ-025`). |
| **Stage 5** | Temporal Cutoff & Canonical Finding Key | Rust (`fpa-core.exe`) | Rejects postings dated after period cutoff (`K2`) and emits uppercase pipe-delimited finding keys `RULE_ID|ENTITY_CODE|ACCOUNT_CODE|PERIOD_CODE|GRAIN` (`K3`). |
| **Stage 6** | Atomic Arrow Batch Commit & Hash-Chain Audit | Rust (`fpa-core.exe`) | Appends validated records to the Arrow columnar store and writes a tamper-evident SHA-256 audit link (`I22`). |

### 2.2 Top-12 ERP Adapter Matrix (`ERP-01` – `ERP-12`)

| ID | ERP Platform | Formats | Primary Table / Schema | Sign & Dialect Rule | Default Gate |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `ERP-01` | **SAP S/4HANA & ECC** | `CSV`, `PARQUET`, `XML` | `ACDOCA` / `BKPF`+`BSEG` | `SHKZG = 'S'` Debit (`+`), `'H'` Credit (`-`); trailing minus `1250000.00-` | `IMP-GL` |
| `ERP-02` | **Oracle Fusion Cloud & EBS** | `CSV`, `XLSX`, `XML` | `GL_JE_LINES` | `ENTERED_DR - ENTERED_CR` across 30-segment Flexfield | `IMP-GL` |
| `ERP-03` | **Microsoft Dynamics 365 F&O / BC** | `CSV`, `PARQUET`, `JSON` | `GeneralJournalAccountEntry` | Signed `AccountingCurrencyAmount` or `IsCredit` flag | `IMP-GL` |
| `ERP-04` | **Oracle NetSuite ERP** | `CSV`, `JSON`, `XLSX` | `TransactionAccountingLine` | `debit - credit` with `subsidiary.id` + `account.number` | `IMP-GL` |
| `ERP-05` | **TallyPrime / Tally.ERP 9** | `XML`, `CSV`, `XLSX` | `ENVELOPE/DSPACCINFO` | Indian lakh grouping (`2,50,000.00 Dr` -> `+`, `Cr` -> `-`) | `IMP-GL` |
| `ERP-06` | **Odoo Enterprise (v16–v18)** | `JSON`, `CSV`, `XLSX` | `account.move.line` | `balance = debit - credit` + analytic distribution JSON weights | `IMP-GL` |
| `ERP-07` | **Sage Intacct & Sage X3** | `CSV`, `XML`, `XLSX` | `GLENTRY` / `GACCENTRYD` | `TR_TYPE = 1` (`+` Debit), `-1` (`-` Credit) | `IMP-GL` |
| `ERP-08` | **Workday Financials & HCM** | `XML`, `CSV`, `JSON` | `Journal_Entry_Line_Data` / HCM Roster | `Debit_Amount - Credit_Amount`; HCM roster routes to `IMP-SUB` | `IMP-SUB` |
| `ERP-09` | **Intuit QuickBooks Enterprise / QBO** | `CSV`, `XLSX`, `JSON` | `JournalEntryLine` / `GeneralLedgerReport` | `Debit - Credit` with hierarchical `Account:SubAccount` | `IMP-GL` |
| `ERP-10` | **Zoho Books (Middle East / UAE FTA)** | `JSON`, `CSV`, `XLSX` | `journal_lines` / UAE FAF | `debit_or_credit` flag + UAE TRN & 5% VAT tax codes | `IMP-GL` |
| `ERP-11` | **Infor M3 / CloudSuite Industrial** | `CSV`, `PARQUET` | `FGLEDG` (`GLS040`) | `EGACAM` signed accounting amount across `CONO`/`DIVI`/`AIT1..7` | `IMP-GL` |
| `ERP-12` | **Universal ISO 21378 (ADS) & OECD SAF-T** | `XML`, `CSV`, `PARQUET`, `JSON` | `AuditFile/GeneralLedgerEntries` | `<DebitAmount>` / `<CreditAmount>` with `<StandardAccountID>` | `IMP-GL` |

---

## 3. Complete One-Stop FP&A Replacement Engines (`I34`, `I35`)

### 3.1 Workforce & UAE Federal Decree-Law No. 33 Art. 51 End-of-Service Gratuity (`I34`)
- **Statutory Base**: Separates **Monthly Basic Salary** (`EOSB` accrual base) from **Allowances** (Housing, Transport, Utilities — excluded from statutory daily rate).
- **Tranche Split**:
  - Years 1–5 (`<= 5.0` years): **21 calendar days of Basic Salary** per year of service.
  - Beyond Year 5 (`> 5.0` years): **30 calendar days of Basic Salary** per additional year of service.
- **Statutory Ceiling**: Capped at **24 months of Total Monthly Remuneration** (`Basic + Allowances`).

### 3.2 CapEx & Fixed Asset NBV Roll-Forward (`I34`)
- Enforces the balance-sheet identity across every period:
  $$\text{Closing NBV}_t = \text{Opening NBV}_t + \text{CapEx Additions}_t - \text{Depreciation Charge}_t - \text{Net Disposals}_t$$
- Enforces `STOCK_CLOSING_LAST` on multi-period quarter/year rollups (`I08`) so closing Net Book Value is never summed across months.

### 3.3 13-Week Direct Cash Flow & Automated Revolver / DSCR Guard (`I35`)
- Tracks weekly direct cash receipts (`AR Collections`) against direct disbursements (`Payroll`, `Vendor AP`, `VAT/CT Remittance`, `Debt Service`).
- Automatically computes required **Revolver Sweep Draws** whenever projected weekly ending cash drops below the policy minimum cash buffer (`1,500,000.00 AED`) and flags **DSCR Covenant Breaches** (`< 1.25x`).

### 3.4 Price-Volume-Mix (`PVM`) Variance Bridge (`I35`)
- Decomposes multi-product revenue variance into **Pure Price Effect**, **Pure Volume Effect**, and **Portfolio Mix / Interaction Effect** with a verified **`0n` fils (`0.00 AED`) unallocated delta**.

---

## 4. 8-Phase Gated Execution Roadmap & Secondary Brain Protocol (`P0`–`P7`, `I36`)

Every phase requires following the 4-step Secondary Brain loop (`_project_brain/00`–`05`):
1. **READ**: Read `_project_brain/00_GOLDEN_RULES.md` and `_project_brain/04_ACTIVE_STATE_AND_TASKS.md`.
2. **VERIFY**: Inspect actual repository files, run existing unit tests, and confirm invariant baselines.
3. **ACT**: Implement only the contract-bounded deliverables for the current phase; wire every new engine into active UI and tests (0% orphan rule `I31`).
4. **MEMORIZE**: Update `_project_brain/02`, `03`, `04`, and `05` before closing the phase.

| Phase | Title | Primary Runtimes | Blocking Invariants | Status |
| :--- | :--- | :--- | :--- | :--- |
| **P0** | Reference Oracle, 36 Invariants, Top-12 ERP Specs & Workbench UI | TypeScript (`frontend-builder`) | `I01`–`I36` | `VERIFIED_IN_REPO` |
| **P1** | Rust Core Financial Engine, Arrow Hyperblock & SQLCipher Vault | Rust (`fpa-core.exe`) | `I01`–`I09`, `I22`, `I26`, `I27` | `CONTRACT_SPECIFIED` |
| **P2** | Go Universal ERP Ingestion Worker & Top-12 Adapter CLI | Go (`fpa-io.exe`) + Rust fallback | `I10`–`I12`, `I30`, `I33` | `CONTRACT_SPECIFIED` |
| **P3** | Consolidation, All 10 Industry Packs & One-Stop FP&A Engines | Rust (`fpa-core.exe`) + TypeScript | `I13`–`I16`, `I21`, `I25`, `I34`, `I35` | `CONTRACT_SPECIFIED` |
| **P4** | Native Windows x64 C-API Excel XLL Add-In (`fpa-xll.xll`) | Rust (`cdylib`) + Excel 2021 x64 | `I17`–`I20`, `I28` | `CONTRACT_SPECIFIED` |
| **P5** | Elixir OTP Close Workflow Supervisor (`fpa-flow`) | Elixir OTP 27 + Rust state machine fallback | `I21`, `I23`, `I30` | `CONTRACT_SPECIFIED` |
| **P6** | Java 25 `jlink` Board PDF/Word Sidecar (`fpa-docs.exe`) | Java 25 LTS (`jlink`) + Rust Typst fallback | `I24`, `I30` | `CONTRACT_SPECIFIED` |
| **P7** | Windows 11 Tauri v2 Desktop Shell, DPAPI & Signed MSI/MSIX | Rust (Tauri v2) + WiX MSI | `I01`–`I36` | `CONTRACT_SPECIFIED` |
