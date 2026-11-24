# 03 — API and contract registry

Status: NO API, ENDPOINT, PROTO OR XLL FUNCTION IMPLEMENTED · 18 Nov 2026

## Rule
No physical route, function, protobuf message, field or error code exists or has been approved. Check actual repository and approved schema before use. Items below are **logical candidates**, not callable endpoints; no exact wire payload is authorized. If task requires one, draft and approve a contract first.

## Candidate contracts / acceptance constraints
| Candidate capability | Request concepts | Response concepts | Mandatory conditions |
|---|---|---|---|
| Project open/unlock | selected project + authorized recovery mechanism | session and revision or clear error | no account/network; never log secrets |
| Import preview/commit | file source, mapping/version, entity, request key, expected revision | validation/reconciliation; committed batch and revision, or error | strict all-or-nothing; stable request hash; persisted idempotency |
| Read model value | explicit workspace/entity/coordinate/scenario/period/revision | decimal value + units/currency/status + revision | authorization before aggregation; no silent stale/zero |
| Excel GET | same coordinate and revision, via native Office 2021 x64 | safe Excel value or visible error/status | read-only; explicit decimal/binary conversion and refresh behavior |
| Excel push command | reviewed selected batch + expected revision + request key | one committed revision/audit or detailed rejection | user confirmation; atomic batch; no worksheet-UDF write |
| Consolidate | confirmed scope/policies, period, entity inputs, rate and revision | report generation, controls, reconciliation and lineage | no default invented control/FX/IC, block approved output on missing inputs |
| Operation status | persistent request key and workspace | committed/rejected/unknown with revision, as permitted | resolve timeout/crash before retry; idempotent semantics |
| Backup / restore | pinned revision + verified user-selected destination/recovery method | verified encrypted artifact or explicit failure | user must be able to recover on another account/device |

## Contract design gate
For every contract, approve exact transport/direction, name/version, request/response schema, required/optional/null semantics, decimal representation, error namespace/codes, auth, timeout/cancel, quotas, idempotency/retry, concurrency and compatibility. Include positive/negative/crash tests and redaction. Until approved, **there are no numerical error codes or public endpoints to cite**. Do not expose arbitrary SQL, shell or untrusted model output as APIs. Decimal money/rates must not travel as JSON binary floats. External endpoints/cloud are absent by default.

## v3.0 / v4.0 Polyglot IPC, Top-12 ERP, Per-Project & Rust Fallback Contracts (Specified — native workers unbuilt in Linux preview)
Per Master Architecture v2.2, v3.0 & Per-Project v4.0 (`../fpa-documentation/docs/21-master-architecture-v2.2.md`, `docs/22-master-roadmap-and-erp-blueprint-v3.0.md`, `docs/23-per-project-master-blueprint-v4.0.md`, and `fpa-documentation/projects/*`), runtime boundaries remain strictly contract-bounded across all 7 Engineering Sub-Projects (`PRJ-CORE`–`PRJ-DIST`) and Multi-Project FP&A Workspaces (`FPA-WORKSPACES`) with Rust fallback toggles and golden JSON parity vectors (`atlas-fpa-v4.0-parity-vectors.json`):
- **Rust (`PRJ-CORE` / `fpa-core.exe`, `PRJ-XLL` / `fpa-xll.xll`)**: Sole authoritative writer; executes `Named Pipe` / in-process commands with UUID idempotency keys (`I28`), signed decimal strings/scaled integers (`I01`), SCD2 CoA resolution (`I33`), Workforce UAE Art. 51 EOSB & CapEx NBV roll-forward (`I34`), 13-week Cash DSCR & PVM variance bridge (`I35`), sealed `project_id` + `project_coa_id` firewall (`I37`), cross-project consolidation FX guard (`I38`), and exact `BigInt` WBS/EAC/PoC % Project P&L tie-out (`I39`).
- **Go (`PRJ-IO` / `fpa-io.exe`)**: Stateless Top-12 ERP (`ERP-01`–`ERP-12`) `CSV`/`XLSX`/`PARQUET`/`XML`/`JSON` ingestion & zstd backup worker over length-framed NDJSON stdio + Arrow IPC temp files, tagged by `project_id` (fallback: `fpa-core::io`).
- **Elixir (`PRJ-FLOW` / `fpa-flow --start-epmd false`)**: Orchestration sagas & close-calendar DAG over framed stdio (`-elixir ansi_enabled false`, zero OS ports / `epmd`; fallback: Rust sequential state-machine).
- **Java 25 `jlink` (`PRJ-DOCS` / `fpa-docs.exe`)**: Apache POI SXSSF OpenXML worker over staging paths & framed stdio (fallback: Rust `rust_xlsxwriter`).
- **React/TS (`PRJ-UI`) & MSI Packaging (`PRJ-DIST`)**: Authoritative UI Workbench + reference oracle (`40/40` invariants `I01`–`I40`, `I40` zero-orphan sub-project traceability) and WiX v4 offline Windows MSI/AppLocker/QA harness.

## Excel P0 XLL constraints
Native Office 2021 64-bit Excel (`fpa-xll.xll`) is P0 for V1. `=FPA.GET(...)` worksheet formulas are strictly read-only (`I20`); side-effecting `=FPA.SET()` is prohibited. Write-backs execute exclusively via explicit signed Command batches against Rust with `project_id` scoping, idempotency keys, and stale-revision checks. Native `.xll` compilation and Office host tests remain pending on Windows 11.
