# PRJ-CORE — Rust Authoritative Financial Engine, Hyperblock & SQLCipher Vault

**Sub-Project ID:** `PRJ-CORE` · **Target Binary:** `fpa-core.exe` · **Language:** Rust (2024 edition) · **Phases Unlocked:** `P1`, `P3`, `P4` · **Status:** Contract-specified (`not yet built in Linux UI preview`)

---

## 1. Identity & Ownership Boundary

`PRJ-CORE` is the **sole authoritative state mutator, calculation engine, and encrypted storage owner** for Atlas FP&A on Windows 11 x64. No other binary (`PRJ-IO`, `PRJ-FLOW`, `PRJ-DOCS`, `PRJ-UI`) may write directly to SQLCipher or execute authoritative monetary rounding.

- **Fallback Responsibility**: Hosts in-process Rust fallbacks (`fpa-core::io`, sequential workflow state machine, and `rust_xlsxwriter` basic OpenXML export) when optional runtimes are disabled via toggle (`I30`).
- **Explicit Non-Goals**: No UI rendering (`PRJ-UI`), no direct Microsoft Excel C-API callbacks (`PRJ-XLL`), and no outbound network sockets (`I24`).

---

## 2. Owned Data & IPC Contract

- **Encrypted Vault**: `SQLCipher` AES-256 database with Windows DPAPI master key envelope (`PRJ-DIST`), explicit `WAL`-reset corruption guard (`D-015`), single-writer mutex, and `sqlite_sequence` revisionmonotonicity.
- **Scale Engine**: 100M+ populated cell `4,096`-cell adaptive **Block-Hybrid Hyperblock** (`EMPTY`, `CONSTANT`, `SPARSE`, `DICT`, `DENSE`) backed by Rayon parallel evaluation and `ChaCha20-Poly1305` encrypted `mmap` cold-block spill (`<= 2,200 MB` active working-set budget, `I26`).
- **Math Representation**: `Fixed128` (`i128` scaled integers: `10^2` fils for money, `10^4` for percentages/ratios, `10^8` for FX rates). Zero `f32`/`f64` permitted (`I01`).
- **Transport**: Local Windows Named Pipe (`\\.\pipe\atlas-fpa-core-<user-sid>`) secured by current-user SID DACL, plus framed stdio workers for child runtimes.

---

## 3. Owned Invariants & Deterministic Parity Vectors

`PRJ-CORE` enforces: `I01`–`I09`, `I11`, `I12`, `I16`, `I17`, `I21`, `I22`, `I26`, `I27`, `I34`, `I35`, `I37`, `I38`, `I39`.
All `Rust` outputs must match `frontend-builder/public/demo/atlas-fpa-v4.0-parity-vectors.json` to the exact scaled integer (`0n` fils delta) across:
- UAE VAT (`U-02`) & Corporate Tax (`U-03`) half-even calculations
- Largest-Remainder `I05` allocations
- Statement `STOCK_CLOSING_LAST`, `RATIO_OF_SUMS`, and Kahn acyclic DAG (`I27`)
- Golden Consolidation (`CONS-001`..`009`, `T-AG-01`, `T-AG-07`, `T-AG-08`)
- Workforce Art. 51 EOSB, CapEx NBV roll-forward, 13-week Cash DSCR, and PVM bridge (`I34`, `I35`)
- Sealed Project CoA firewall, Multi-Currency FX consolidation guard, and WBS/PoC EAC math (`I37`–`I39`)

---

## 4. Security, Audit & Crash Recovery

- Every state commit executes inside a single SQLCipher ACID transaction persisting: (a) state mutation, (b) bumped revision, (c) idempotency key + SHA-256 request digest (`I28`), and (d) append-only FIPS 180-4 SHA-256 audit chain link (`I22`).
- Unresolved crashes roll back uncommitted WAL frames cleanly; ambiguous commit recovery queries persisted idempotency keys rather than blind-retrying.

---

## 5. Phase Exit Gate & Verification Command

- **Phase P1 Gate**: `cargo test --workspace -- --nocapture` (100% match against `atlas-fpa-v4.0-parity-vectors.json`).
- **Phase P3 Gate**: `cargo bench --bench hyperblock_100m` (`<= 2,200 MB` RAM, `0.00 fils` allocation/PVM drift).
- **Phase P4 Gate**: `cargo test -p fpa-core --test consolidation_and_blueprints`.
