# PRJ-XLL — Native Windows x64 Office 2021 Excel Add-In

**Sub-Project ID:** `PRJ-XLL` · **Target Binary:** `fpa-xll.xll` (C-ABI `cdylib`) · **Language:** Rust (`cdylib` via Windows Excel XLL SDK) · **Phases Unlocked:** `P4`, `P6` · **Status:** Contract-specified (`not yet built in Linux UI preview`)

---

## 1. Identity & Ownership Boundary

`PRJ-XLL` delivers **V1 Priority-0 (P0) native Microsoft Office 2021 64-bit Excel integration** without VBA security nightmares or unencrypted COM shims.

- **Strict Read-Only Worksheet Formula Guarantee (`I20`)**:
  - `=FPA.GET(entity, account, period, scenario)` (plus `project_id` namespace argument in v4.0) executes as a thread-safe Excel C-API UDF reading committed values from `PRJ-CORE` over a user-SID-restricted Named Pipe.
  - Side-effecting write-on-recalc functions (`=FPA.SET(...)`) are **strictly blocked (`#BLOCKED!`)** during worksheet recalculation.

---

## 2. Precision Guard & Idempotent Command Write-Back Contract (`I28`)

1. **15-Significant-Digit IEEE-754 Guard**: Because Excel stores worksheet numbers as 64-bit binary floats (`f64`), `fpa-xll.xll` checks significant digits before returning a numeric scalar. Any balance exceeding 15 significant digits triggers `#NUM! (Precision Loss Guard)` and exposes the exact authoritative decimal string in the XLL task-pane inspector.
2. **Explicit Missing Value Distinction (`I04`)**: Unsupplied coordinates return `#N/A (Not provided)` — never silent `0`.
3. **Explicit Signed Command Batch Push**: Planning write-backs from Excel occur solely via an explicit user-confirmed Command button sending `(idempotency_key, expected_revision, sha256_payload_hash, project_id, cells[])` to `PRJ-CORE`:
   - Matching key + matching hash replays safely (`IDEMPOTENT_REPLAY`).
   - Matching key + altered hash rejects with `409 IDEMPOTENCY_CONFLICT`.
   - Stale workbook revision rejects with `412 STALE_REVISION_CONFLICT`.

---

## 3. Owned Invariants & Residual Risk Note

`PRJ-XLL` enforces: `I20`, `I28`.
Per `_project_brain/00_GOLDEN_RULES.md`, Excel workbooks saved by the user on disk can retain cached values and plaintext worksheet copies outside SQLCipher; documentation must never claim Excel-saved files are encrypted by the add-in.

---

## 4. Phase Exit Gate & Verification Command

- **Phase P6 Gate**: `cargo test -p fpa-xll && office2021-xll-smoke.ps1` (verifies `=FPA.GET`, `#BLOCKED!` on `=FPA.SET`, `>15`-digit guard, and Command idempotency inside live 64-bit Office 2021 Excel).
