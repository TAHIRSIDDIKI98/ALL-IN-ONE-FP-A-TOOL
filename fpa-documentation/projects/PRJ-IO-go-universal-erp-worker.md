# PRJ-IO — Go Universal Top-12 ERP Ingestion & Encrypted Backup Worker

**Sub-Project ID:** `PRJ-IO` · **Target Binary:** `fpa-io.exe` · **Language:** Go 1.24+ · **Phases Unlocked:** `P2`, `P7` · **Fallback:** `Rust fpa-core::io` (`I30`) · **Status:** Contract-specified (`not yet built in Linux UI preview`)

---

## 1. Identity & Ownership Boundary

`PRJ-IO` is a **stateless, high-throughput streaming ETL and snapshot archival worker**. It ingests raw extracts from all Top-12 ERP platforms (`ERP-01`–`ERP-12`) across `CSV`, `XLSX`, `PARQUET`, `XML`, and `JSON`, normalizes dialect-specific signs and account strings into canonical integer records, and hands staged Arrow IPC payloads to `PRJ-CORE` for ACID validation and commit.

- **Explicit Non-Goals**: Never holds a direct write lock on `SQLCipher`, never commits GL balances silently around `IMP-GL` / `IMP-SUB` gates, and never invents default CoA mappings.

---

## 2. 6-Stage Ingestion & Dialect Normalization Contract

1. **Physical Stream & SHA-256 Manifest**: Computes raw byte digest before parsing (`manifestSha256`).
2. **ERP Dialect Normalization (`ERP-01`–`ERP-12`)**:
   - SAP S/4HANA `ACDOCA` (`SHKZG = 'S'/'H'`, trailing `-`, `POPER 013..016`)
   - Oracle Fusion `GL_JE_LINES` (30-segment Flexfield split + `ENTERED_DR - ENTERED_CR`)
   - Dynamics 365 `GeneralJournalAccountEntry` (`IsCredit`)
   - NetSuite `TransactionAccountingLine` (`Parent : Child` subsidiary hierarchy)
   - TallyPrime XML (`2,50,000.00 Dr/Cr` lakh grouping)
   - Odoo analytic JSON weights (exact sum via `I05` Largest-Remainder)
   - Sage Intacct/X3 (`TR_TYPE = 1/-1`), Workday Financials/HCM (`IMP-SUB`), QuickBooks (`Account:Sub`), Zoho Books UAE FTA, Infor M3 (`AIT1..AIT7`), ISO 21378 / OECD SAF-T 2.0.
3. **Project Isolation & CoA Stamping (`I37`)**: Stamps explicit `project_id` and `coa_namespace`; rejects cross-project account leakage before staging.
4. **Source-Scoped Gate Routing (`I13`)**: Separates `IMP-GL` (`SUM(Dr) == SUM(Cr)`) from `IMP-SUB` (`BANK_SUBLEDGER`, `PAYROLL_REGISTER`, `PROPERTY_RENT_ROLL` control-total checks, resolving `OQ-025`).
5. **Encrypted zstd Snapshot Packfiles (`I23`)**: Bundles pinned database backups + parity manifests with dry-run restore verification before overwriting active state.

---

## 3. Owned Invariants

`PRJ-IO` enforces: `I03`, `I04`, `I10`, `I13`, `I14`, `I15`, `I23`, `I30`, `I33`, `I37`.

---

## 4. Phase Exit Gate & Verification Command

- **Phase P2 Gate**: `go test ./... && cargo test -p fpa-core --test erp_fallback_parity` (all 12 ERP vectors + `QUARANTINED_UNMAPPED_COA` + `OQ-025`/`K2`/`K3` checks match `atlas-fpa-v4.0-parity-vectors.json`).
