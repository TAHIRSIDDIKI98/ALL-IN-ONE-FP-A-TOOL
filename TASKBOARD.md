# OneFP&A — Live Ledger (TASKBOARD.md)

> Single source of truth for execution state, evidence, decisions, ports, and handovers (MASTER_PROMPT §8.1, §8.6).
> Status vocabulary (§8.5): `NOT_STARTED` · `IN_PROGRESS` · `EXISTS_UNVERIFIED` · `VERIFIED` · `BLOCKED` · `DEFERRED(phase)`

---

## §Position
- **Current Milestone**: `M0 FOUNDATION`
- **Current WI**: `WI-0006` (Audit Hash Chain P11)
- **Next WI**: `WI-0007` (M1 18-Table Schema Migrations on PGLite)
- **Red Gates**: None (`npm run verify` 12/12 green in 13.3s).

---

## §Work Items

| ID | Milestone | Mission | Depends On | Spec Refs | Acceptance Criteria | Paired Test | Oracle | Cut-Line Check | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| WI-0001 | M0 | Create exact §3.3 repository structure, four constitutional docs + pointer files, strict TS/Vite/Vitest/Playwright config, and GitHub Actions CI with failure artifact upload. | — | §1.1, §1.2, §6 | 1. Root matches §3.3 [x]; 2. Pointer files exact [x]; 3. Strict TS compiles [x]; 4. CI workflow uploads diagnostics on failure (PR5) [x]. | `scripts/repo-layout.test.ts` | `MASTER_PROMPT.md §3.3` | Y (M0) | VERIFIED | `tsc --noEmit` exit 0; `vitest run scripts/repo-layout.test.ts` -> `1 passed (1), 4 passed (4)`; `vite build` -> `dist/assets/index-bfonkSHI.js 188.36 kB │ gzip: 59.34 kB` |
| WI-0002 | M0 | Implement sandbox structural gates (`core-purity`, `secret-scan`, `no-native-deps`, `schema-scope`) and port P01–P04 honesty detectors (`money-ast`, `tautology`, `fabrication`, `readme-claims`). | WI-0001 | §1.1, §6 | 1. Each gate exits non-zero on planted violation [x]; 2. Each gate exits 0 on clean repo [x]; 3. Provenance headers on P01–P04 [x]. | `scripts/gates.test.ts` | Planted violation fixtures | Y (M0) | VERIFIED | `npm run verify` -> `VERIFY GREEN: 12/12 gates passed in 10136ms (<60000ms budget, 0 secrets)` (`scripts/gates.test.ts` 8/8 passed; PR8 stop-the-line demonstrated on tautology gate before fix) |
| WI-0003 | M0 | Port P12 typed error catalog (`/shared/errors.ts`) and baseline shared `zod` envelopes. | WI-0001 | §1.1, §6 | 1. Every error has stable code, HTTP status, user text [x]; 2. Zero `any` in `/shared` [x]. | `shared/errors.test.ts` | Error catalog table | Y (M0) | VERIFIED | `npm run verify` -> `VERIFY GREEN: 12/12 gates passed in 12429ms (<60000ms budget, 0 secrets)` (`shared/errors.test.ts` 3/3 passed across 26 typed error codes) |
| WI-0004 | M0 | Port & verify `/core/money` single primitive set, amount parser, string serializer, and largest-remainder allocator (P05–P08, P20). | WI-0002, WI-0003 | §3.1–§3.3 | 1. Currency scales 0/2/3 [x]; 2. Parser handles §5.2 formats & quarantines ambiguity [x]; 3. Serializer emits strings only [x]; 4. `allocate` passes 10,000 seeded cases + oracle fixtures [x]; 5. 10k sum < 50ms [x]. | `core/money/money.test.ts` | `/fixtures/oracles/allocation/allocation_oracles.json` | Y (M0) | VERIFIED | `npm run verify` -> `VERIFY GREEN: 12/12 gates passed in 13721ms (<60000ms budget, 0 secrets)` (`core/money/money.test.ts` 5/5 passed incl. 10,000 BigInt-verified random allocations + 10k sum < 50ms) |
| WI-0005 | M0 | Port Class A calendar fixtures (P09) and implement `/core/calendar` period generator (P10). | WI-0004 | §3.6 | 1. Q2 calendar fixtures byte-unmodified & SHA-256 verified [x]; 2. `12month`, `445`, `454`, `544`, `52_53` (incl. 2028 W53), `13x4` match oracles [x]. | `core/calendar/calendar.test.ts` | `/fixtures/oracles/calendar/` | Y (M0) | VERIFIED | `npm run verify` -> `VERIFY GREEN: 12/12 gates passed in 13265ms (<60000ms budget, 0 secrets)` (`core/calendar/calendar.test.ts` 4/4 passed; SHA-256 checksums intact) |
| WI-0005B | M0 | Append Parts 11 & 12 (`MASTER_PROMPT.md` v1.2) and enforce M0 addon gates (`GOV1–3`, `LIC1–3`, `VER1/3`, `TST1`). | WI-0005 | §1, §6 | 1. `MASTER_PROMPT.md` v1.2 changelog + zero dangling refs [x]; 2. `LICENSE` + `THIRD_PARTY_LICENSES.md` + `license-check` green (678 pkgs) [x]; 3. `CHANGELOG.md` + `docs/adr/0001..0002` verified [x]; 4. `TST1` property laws green [x]. | `scripts/gates.test.ts`, `core/money/money.test.ts` | `MASTER_PROMPT.md §11.14, §11.17, §12.15, §12.16` | Y (M0) | VERIFIED | `npm run verify` -> `VERIFY GREEN: 14/14 gates passed in 13353ms (<60000ms budget, 0 secrets)` |
| WI-0005C | M0 | Append Part 13 (`MASTER_PROMPT.md` v1.3 Work-Integrity Codex) and enforce `INT1–INT13` + quality ratchet. | WI-0005B | §1, §6 | 1. `MASTER_PROMPT.md` v1.3 saved & GOV2 green [x]; 2. `work-integrity.mjs` enforces `INT1–INT13` & fails on planted violations [x]; 3. `integrity-ratchet.json` initialized [x]; 4. Verbatim §13.9 attestations recorded [x]. | `scripts/gates.test.ts` | `MASTER_PROMPT.md §13.1–§13.12` | Y (M0) | VERIFIED | `npm run verify` -> `VERIFY GREEN: 15/15 gates passed in 14013ms (<60000ms budget, 0 secrets)` |
| WI-0006 | M0 | Port `/core/audit` SHA-256 canonical JSON hash chain (P11). | WI-0003 | §2.2 | 1. Genesis prev_hash = 64 zeros; 2. Deterministic key-sorted canonical JSON; 3. Mutation of any historical payload breaks chain verification. | `core/audit/audit.test.ts` | Hand-computed SHA-256 vectors | Y (M0) | IN_PROGRESS | — |
| WI-0007 | M0 | Author `db/migrations/0001_m1_spine.sql` (exact 18 M1 tables) and verify positive + negative constraints on PGLite (`D1–D7`, `D9`). | WI-0005, WI-0006 | §2.1, §2.2 | 1. Exactly 18 tables (`schema-scope` green); 2. Composite company FKs block cross-tenant refs; 3. Deferred trigger rejects unbalanced `gl_entry` at COMMIT; 4. `gl_line` rejects invalid debit/credit; 5. `audit_log` trigger blocks UPDATE/DELETE. | `server/db/schema.test.ts` | Independent constraint expectations | Y (M0) | NOT_STARTED | — |
| WI-0008 | M0 | Port Class A CoA & statement fixtures (P15, P18) and implement `/core/statements`, `/core/variance`, `/core/invariants` (P17, P19). | WI-0004 | §3.4, §3.5 | 1. Leading zeros preserved on CoA codes; 2. EBITDA `+300` oracle green; 3. Articulation A1–A5 green; 4. Variance `0/0`, `x/0 -> n/m`, negative plan, favorability, and PVM exact sum green. | `core/statements/statements.test.ts` | `/fixtures/oracles/coa/`, `/fixtures/oracles/statements/` | Y (M0) | NOT_STARTED | — |
| WI-0009 | M0 | Build deterministic plan-first corpus generator (`/fixtures/corpus/generator.ts`), commit generated corpus + `answer_key.json`, and verify with non-`/core` BigInt oracle script (`S6`, `C1–C4`). | WI-0005, WI-0008 | §4 | 1. Same seed -> byte-identical output; 2. Zero unregistered plan/actual noise; 3. A1–A5 green on corpus; 4. Non-`/core` integer minor-unit oracle matches exact figures. | `fixtures/corpus/corpus.test.ts` | `/fixtures/oracles/expected/corpus_expected.json` | Y (M0) | NOT_STARTED | — |
| WI-0010 | M0 | Wire Express server + React 7-screen spine shell (five-state honest foundations), Playwright spine harness, and `npm run verify` (`S2`, `S7`, `PR1–PR8`). | WI-0007, WI-0009 | §1.2, §5 | 1. Exactly 7 spine routes exist; 2. Playwright harness executes; 3. Client bundle < 250KB gzip; 4. `npm run verify` exits 0 in < 60s with zero secrets/network. | `e2e/spine-harness.spec.ts` | All M0 gates S1–S8, PR1–PR8 | Y (M0) | NOT_STARTED | — |

---

## §Gates

| Gate | Command | Exit Code | Timestamp (UTC) | Output Tail |
|---|---|---|---|---|
| `verify` | `npm run verify` | `0` | `2026-11-24T10:39:00Z` | `VERIFY GREEN: 15/15 gates passed in 14013ms (<60000ms budget, 0 secrets).` |

---

## §Decisions

| ID | Date | Decision | Rationale | Alternatives Considered | Owner-Approved |
|---|---|---|---|---|---|
| DEC-001 | 2026-11-24 | Initialize local git repository on `main` at `/home/user` and execute M0 work items sequentially (`WI-0001` → `WI-0010`) with one commit per WI and pasted `verify` output. | Enforces MASTER_PROMPT §1.9, §3.3, §8.2, §8.9 in a fresh workspace where no remote git repo was pre-cloned. | Multi-item sweep commit (banned by §8.2). | N (within locked §1.8 scope) |
| DEC-002 | 2026-11-24 | Configure `engines.node` as `>=20.20.0` locally while targeting Node 22 LTS in `.github/workflows/ci.yml` (`node-version: '22'`). (`ADR-0001`) | Sandbox container provides Node `v20.20.2` without root/nvm to install Node 22; Node 20.20 and Node 22 share identical ESM/crypto/`fetch` semantics for our pure TS + PGLite stack, preserving in-sandbox verifiability (§1.4-4, §3.1) while enforcing Node 22 LTS in CI. | Blocking all M0 work waiting on container base image change (violates §1.10 momentum). Logged in §Questions Q-002 for owner confirmation. | N (pending owner ack in Q-002) |
| DEC-003 | 2026-11-24 | Append Part 11 (v1.1) and Part 12 (v1.2) to `MASTER_PROMPT.md` per explicit owner command, activating M0 governance/license/ADR/property-test gates (`GOV1–3`, `LIC1–3`, `VER1/3`, `TST1`) while keeping M1–M6 addon contracts behind the §2.3 cut line. (`ADR-0002`) | Direct owner command ("SAVE AND FOLLOW THIS ADDON PROMPT"). | — | Y (Owner Command) |
| DEC-004 | 2026-11-24 | Append Part 13 (v1.3 — Final Addon: The Work-Integrity Codex) to `MASTER_PROMPT.md` per explicit owner command, activating `/scripts/work-integrity.mjs` (`INT1–INT13` + `S-PLACEHOLDER`, `S-SUPPRESS`, `S-DEAD-CONTROL`, `S-TEST-INTEGRITY`, `S-SWALLOW`, `S-DEBUG`, `S-COMMIT`, `S-CUTLINE`, `S-RATCHET`) and recording verbatim §13.9 attestations for every `VERIFIED` work item. (`ADR-0003`) | Direct owner command ("ALSO ADD THIS IN MASTER PROMPT ALSO FOLLOW IT"). | — | Y (Owner Command) |

---

## §Blockers

None blocking M0 sandbox execution.

---

## §Questions

| ID | Date | Question / Escalation | Context & Impact |
|---|---|---|---|
| Q-001 | 2026-11-24 | **Quarry Path Verification (§6.1 Escalation)**: Inspecting `TAHIRSIDDIKI98/fp-A-betterversion @ 86d785ca696c` via GitHub API showed that `scripts/money-ast-detector.mjs` and `scripts/fabrication-detector.mjs` exist, whereas `src/utils/moneyAstDetector.ts` (listed alongside `.mjs` in P01) and `src/utils/fabricationDetector.ts` (listed in P03; actual path in Q1 is `scripts/fabrication-detector.mjs`) do not exist at `src/utils/`. Please confirm using `scripts/money-ast-detector.mjs` for P01 and `scripts/fabrication-detector.mjs` for P03. | Per §6.1 ("if a path has moved or is missing, STOP and escalate; never guess a path"), we inspected Q1's exact tree and verified the detector scripts live in `scripts/` in Q1. |
| Q-002 | 2026-11-24 | **Sandbox Node Version vs CI Node 22 LTS**: This Arena sandbox provides Node `v20.20.2` (non-root, no version manager), whereas §3.2 specifies Node 22 LTS. CI (`.github/workflows/ci.yml`) is pinned to Node 22 LTS and `engines` permits `>=20.20.0` so `npm run verify` executes natively in-sandbox. Please confirm this is acceptable for sandbox runs, plus share target GitHub remote URL if you want git push wired. | Keeps Directive 4 (in-sandbox verifiability `< 60s`) operational immediately while keeping CI on Node 22 LTS. |
| Q-003 | 2026-11-24 | **Quarry Path Verification for P20 (`src/test/statement-fixtures.test.ts`)**: `fp-A-betterversion @ 86d785ca696c` has no `src/test/` directory (allocation cases in Q1 live in `src/utils/money.test.ts` KAV-07 and Q2 `src-tauri/src/core/money.rs`). Hand-computed allocation vectors + 10,000 seeded BigInt-verified cases are committed at `/fixtures/oracles/allocation/allocation_oracles.json` while flagging this moved path per §6.1. Please confirm `/fixtures/oracles/allocation/allocation_oracles.json` as the canonical P20 oracle. | Preserves §5.4 E4 proof and §6.1 transparency without guessing a quarry path. |

---

## §Proposals

None.

---

## §Temptations

None.

---

## §Ports

| ID | Source Repo / Path @ Commit | Destination | Class | Oracle / Proof | Status | Evidence |
|---|---|---|---|---|---|---|
| P01 | `fp-A-betterversion/scripts/money-ast-detector.mjs @ 86d785ca696c` (see Q-001 re `src/utils/moneyAstDetector.ts`) | `/scripts/money-ast.mjs` | B | Flags raw `+,-,*,/`, `Math.abs`, `toFixed`, `Number()` on money; green on `/core`, red on planted violation | VERIFIED | `scripts/gates.test.ts` planted violation exit 1 + `npm run verify` 12/12 green (10136ms) |
| P02 | `fp-A-betterversion/scripts/check-tautological-tests.mjs @ 86d785ca696c` | `/scripts/tautology.mjs` | B | Detects planted self-recomputing test | VERIFIED | `scripts/gates.test.ts` planted violation exit 1 + `npm run verify` 12/12 green (10136ms) |
| P03 | `fp-A-betterversion/scripts/fabrication-detector.mjs @ 86d785ca696c` (see Q-001 re `src/utils/fabricationDetector.ts`) | `/scripts/fabrication.mjs` | B | Flags planted hardcoded KPI / zero-for-absence rendered as data | VERIFIED | `scripts/gates.test.ts` planted violation exit 1 + `npm run verify` 12/12 green (10136ms) |
| P04 | `fp-A-betterversion/scripts/check-readme-claims.mjs @ 86d785ca696c` | `/scripts/readme-claims.mjs` | B | Flags planted unverified README claim | VERIFIED | `scripts/gates.test.ts` planted violation exit 1 + `npm run verify` 12/12 green (10136ms) |
| P05 | `fp-A-betterversion/src/utils/money.ts @ 86d785ca696c` + Q2 `src-tauri/src/core/money.rs @ 6f6f72f5b681` + Q3 `app/core/money.py @ 641d3d830573` | `/core/money/index.ts` | B | Currency scales, `HALF_UP`, exact equality; E1–E4 oracles | VERIFIED | `core/money/money.test.ts` 5/5 passed; `npm run verify` 12/12 green (13721ms) |
| P06 | `fp-A-betterversion/src/utils/decimalUtils.ts @ 86d785ca696c` | Merged into `/core/money/index.ts` | B | Single money API (no duplicate module; epsilon `areClose` dropped per §5.2) | VERIFIED | `core/money/money.test.ts` 5/5 passed; `npm run verify` 12/12 green (13721ms) |
| P07 | `fp-A-betterversion/src/utils/parseFinancialAmount.ts @ 86d785ca696c` | `/core/money/parse.ts` | B | §5.2 parsing formats; blank/em-dash -> `null`; ambiguous -> quarantine | VERIFIED | `core/money/money.test.ts` 5/5 passed; `npm run verify` 12/12 green (13721ms) |
| P08 | `fp-A-betterversion/src/utils/moneySerialize.ts @ 86d785ca696c` | `/core/money/serialize.ts` | B | Money serialized strictly as strings across boundaries (E11) | VERIFIED | `core/money/money.test.ts` 5/5 passed; `npm run verify` 12/12 green (13721ms) |
| P09 | `fpa/tests/fixtures/calendar/* @ 6f6f72f5b681` | `/fixtures/oracles/calendar/` | A | SHA-256 checksummed (`CHECKSUMS.json`), byte-unmodified | VERIFIED | `core/calendar/calendar.test.ts` 4/4 passed; `npm run verify` 12/12 green (13265ms) |
| P10 | `fpa/src-tauri/src/core/calendar.rs @ 6f6f72f5b681` + Q1 `src/utils/fiscalPeriods.ts @ 86d785ca696c` | `/core/calendar/index.ts` | B | Matches P09 NRF 2024–2028 oracles + all §5.8 kinds | VERIFIED | `core/calendar/calendar.test.ts` 4/4 passed; `npm run verify` 12/12 green (13265ms) |
| P11 | `fpa/src-tauri/src/core/audit.rs @ 6f6f72f5b681` + Q3 `app/core/hashing.py @ 641d3d830573` + Q1 `server/src/db/auditSchema.ts @ 86d785ca696c` | `/core/audit/index.ts` + `/server/audit/index.ts` | B | SHA-256 hash chain + tamper detection (D7) | NOT_STARTED | — |
| P12 | `fpa/src-tauri/src/core/error.rs @ 6f6f72f5b681` + Q3 `app/core/errors.py @ 641d3d830573` | `/shared/errors.ts` | B | Typed error catalog with stable codes and user messages | VERIFIED | `shared/errors.test.ts` 3/3 passed; `npm run verify` 12/12 green (12429ms) |

---

## §Attestations

- **WI-0001**: I attest under the Work-Integrity Codex that: (1) every §13.1 condition is true; (2) I ran the tests and pasted real output; (3) I introduced no placeholder, stub, suppression, fake value, or partial state; (4) error/empty/edge/negative cases are handled and tested; (5) no gate regressed; (6) this attestation is truthful.
- **WI-0002**: I attest under the Work-Integrity Codex that: (1) every §13.1 condition is true; (2) I ran the tests and pasted real output; (3) I introduced no placeholder, stub, suppression, fake value, or partial state; (4) error/empty/edge/negative cases are handled and tested; (5) no gate regressed; (6) this attestation is truthful.
- **WI-0003**: I attest under the Work-Integrity Codex that: (1) every §13.1 condition is true; (2) I ran the tests and pasted real output; (3) I introduced no placeholder, stub, suppression, fake value, or partial state; (4) error/empty/edge/negative cases are handled and tested; (5) no gate regressed; (6) this attestation is truthful.
- **WI-0004**: I attest under the Work-Integrity Codex that: (1) every §13.1 condition is true; (2) I ran the tests and pasted real output; (3) I introduced no placeholder, stub, suppression, fake value, or partial state; (4) error/empty/edge/negative cases are handled and tested; (5) no gate regressed; (6) this attestation is truthful.
- **WI-0005**: I attest under the Work-Integrity Codex that: (1) every §13.1 condition is true; (2) I ran the tests and pasted real output; (3) I introduced no placeholder, stub, suppression, fake value, or partial state; (4) error/empty/edge/negative cases are handled and tested; (5) no gate regressed; (6) this attestation is truthful.
- **WI-0005B**: I attest under the Work-Integrity Codex that: (1) every §13.1 condition is true; (2) I ran the tests and pasted real output; (3) I introduced no placeholder, stub, suppression, fake value, or partial state; (4) error/empty/edge/negative cases are handled and tested; (5) no gate regressed; (6) this attestation is truthful.
- **WI-0005C**: I attest under the Work-Integrity Codex that: (1) every §13.1 condition is true; (2) I ran the tests and pasted real output; (3) I introduced no placeholder, stub, suppression, fake value, or partial state; (4) error/empty/edge/negative cases are handled and tested; (5) no gate regressed; (6) this attestation is truthful.

---

## §Handover

*(Session 1 initialized — handover block will be appended at session completion per §8.4.)*
