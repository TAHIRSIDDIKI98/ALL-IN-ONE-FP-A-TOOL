# 10 — First sprint and executable task contracts

## Before product code
1. Owner answers `09-decisions-research.md`, chooses pilot.
2. Finance reviewer approves golden example, statement scope and decimal/rounding; security reviewer approves threat boundary/recovery; product owner signs V1/G0.
3. Freeze baseline in version control with owners. Create requirement/test registry and ADR files from templates. Establish Windows 11 machine and clean offline VM. Agree dependencies/capacity.
4. Run small **throwaway** compatibility spikes; results are evidence, not production code. Then bootstrap shipping skeleton and lock tested toolchains. Don't run all runtimes merely to satisfy language count.

## Ordered backlog
| ID | Outcome | Depends on | Gate |
|---|---|---|---|
| DOC-001 | Approve vision, V1 requirements, owner/SME, glossary, decisions, non-goals | owner answers | G0 |
| DOC-002 | Requirement/test registry, ADR index, reviews and finance golden fixture | DOC-001 | G0 |
| SPIKE-001 | Tauri prototype install on clean offline Windows, prerequisite absent/present; label unsigned test build honestly | DOC-001 | G1 |
| SPIKE-002 | Job Object and pipe ACL/handshake for one sidecar; record package/startup/RAM/transport | DOC-001 | G1 |
| SPIKE-003 | SQLCipher/DuckDB encryption and backup/restore including WAL/temp; licenses | DOC-001 | G1 |
| SPIKE-004 | Java/Go/Elixir minimal Windows package and prerequisites when intended; decide Elixir timing | DOC-001 | G1 |
| SPIKE-X01 | Native Excel offline: load XLL, read value, refresh revision and explicitly write back via command, or document a blocker; see `11-uae-excel-v1.md` | DOC-001 + supported Excel | G1 |
| ARC-001 | Ratify storage, IPC, decimal and packaging ADRs from spike evidence | spikes | G1 |
| BOOT-001 | Clean monorepo, pinned toolchains, formatting, synthetic fixtures, tests, no network runtime | ARC-001 | G2 |
| PROJ-001 | Project create/open/lock and encrypted recovery | BOOT-001 | G2 |
| IMP-001 | CSV strict validate/stage/commit, idempotency, crash recovery | PROJ-001 | G2 |
| CALC-001 | Typed decimal, basic formula/dependency graph | BOOT-001 + SME | G2 |
| UI-001 | Accessible table/keyboard, revision/status | CALC-001 | G2 |
| AUD-001 | Atomic audit on commits and checkpoint verification | PROJ-001 | G2 |
| E2E-001 | Offline synthetic flow, backup/restore and recovery evidence | IMP/CALC/UI/AUD | G2 |
| FIN-001 | Trial balance, mapping, P&L and reconciliation | E2E-001 | G3 |
| FIN-002 | Linked BS + indirect CF with approved sign mapping | FIN-001 | G3 |
| PLAN-001 | Versioned assumptions, branch/compare/merge conflicts | CALC-001 | G3 |
| RPT-001 | Variance, lineage and documented CSV/XLSX | FIN-001, PLAN-001 | G3 |
| EXCEL-001 | Productize native offline Excel read, revision refresh, command-based preview/write-back, restart and recovery | SPIKE-X01, PROJ-001 | G3 |
| UAE-001 | AED/fiscal defaults and manual tax-assumption schedule with reviewer-approved labels | DOC-002 | G3 |
| REL-001 | Offline install/upgrade/restore, native Excel, security, performance and UAT | G3, EXCEL-001, UAE-001 | G4 |

## Example ticket: IMP-001 (draft)
**Goal:** source-to-authority CSV import with no silent partial commit. Links PRD-003 and architecture ingest protocol. Inputs: local UTF-8, explicit column mapping/period/currency, stable batch ID. Output: one committed manifest with counts/totals/source hash or structured row errors. Expected revision required. Strict all-or-nothing. No arbitrary adapter paths, network, adapter DB write or real fixture data.

**Acceptance:**
1. Finance-approved synthetic balanced journals with valid mapping → expected source rows, period totals, one manifest and audit record; projection matches committed generation.
2. Same key/config → original batch ID, no duplicate rows; same key/different request → explicit conflict.
3. Missing account, malformed decimal, unbalanced journal or out-of-calendar date → detailed error, no committed batch/audit mutation.
4. Kill at each protocol step → no uncommitted batch visible; committed manifest references intact artifact; projection catches up or blocks dependent reporting; retry safe.
5. Disk full/corruption/lost access → explicit error, previous revision readable, no false approved report. Verify actual Windows filesystem behavior.
6. Finance/security reviewers sign expected totals, temp privacy and audit; attach commands, OS and evidence. No completion on stubs. Fixtures and exact totals must be created and approved before implementation; they do not yet exist.

## Completion report template
```text
Task / linked requirements:
Changes (paths + behavior):
Commands and observed results (environment, exact result):
Not run and why; actual Windows offline verification status:
Finance/security review (reviewer/result or pending):
Docs/traceability updated; risks/blockers:
Next task (only if gate approved):
```


## v0.3 priority addition
Before DOC-001, identify the senior’s exact Al Ghurair organization/website and obtain a sanitized scope. Add cross-business/multi-entity management reporting and a native 64-bit Excel test as P0; no unadjusted sum is called consolidated. See documents 14–15.


## v0.5 user-confirmed scope
Both public Al Ghurair websites are included in business research per user; true group consolidation and Office 2021 64-bit Excel add-in are required. Exact legal perimeter/policies are unconfirmed. Read `../_project_brain/00_GOLDEN_RULES.md`, `../_project_brain/04_ACTIVE_STATE_AND_TASKS.md`, and `19-consolidation-scope.md`; wait for Brain approval before Task #1.
