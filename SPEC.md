# OneFP&A — Living Specification (SPEC.md)

> Scope: **Current Phase (M0 Foundation)** + **Next Phase (M1 The Spine)** ONLY (MASTER_PROMPT §8.1, §8.11).
> Authority: Owner commands > `MASTER_PROMPT.md` > `SPEC.md` > `TASKBOARD.md`.

---

## 1. Repository & Stack Specification (M0 — Gates S1–S8)

### 1.1 Directory Contract
- `/core`: Pure TypeScript + `decimal.js` financial kernel (`money/`, `calendar/`, `statements/`, `variance/`, `allocation/`, `audit/`, `import/`). Zero IO, zero framework imports. Enforced by `/scripts/core-purity`.
- `/shared`: Canonical `zod` API schemas, typed error catalog (`errors.ts`), and shared TS types. `any` is banned in `/core` and `/shared`.
- `/server`: Express 5 HTTP API (`routes/`, `db/`, `auth/`, `audit/`). Calls `/core` for all calculations; parameterized SQL via `postgres` (postgres.js) or PGLite adapter in sandbox tests.
- `/src`: React 19 + Vite + Tailwind CSS + TanStack Query + Zustand + lazy-loaded AG Grid Community.
- `/db`: Forward-only numbered SQL migrations (`migrations/0001_*.sql`), schema snapshot (`schema.snapshot.json`), and seed scripts.
- `/fixtures`: `oracles/` (Class A checksummed fixtures + independent non-`/core` expected JSONs + workbook), `corpus/` (deterministic sample company generator + committed artifacts), `messy-exports/` (synthetic real-world import fixtures + manifests).
- `/e2e`: Playwright spine specs.
- `/scripts`: Executable gate runners with non-zero exit codes on violation (`verify`, `core-purity`, `money-ast`, `tautology`, `fabrication`, `readme-claims`, `secret-scan`, `no-native-deps`, `schema-scope`, `tie-out`).

### 1.2 Verification Command
- `npm run verify` executes all sandbox gates in `< 60s` with zero external secrets and zero network credentials required.

---

## 2. Data Model & Schema (M0–M1 — Gates D1–D9)

### 2.1 Approved M1 Table Set (Exactly 18 Tables)
1. `app_user`
2. `company`
3. `membership`
4. `fiscal_calendar`
5. `fiscal_period`
6. `statement_line`
7. `account`
8. `entity`
9. `department`
10. `coa_mapping`
11. `import_batch`
12. `import_row_raw`
13. `gl_entry`
14. `gl_line`
15. `scenario`
16. `plan_version`
17. `plan_line`
18. `audit_log`

Enforced by `/scripts/schema-scope`: any table outside this set fails the build.

### 2.2 Integrity Constraints
- **IDs & Tenancy**: `uuid PRIMARY KEY DEFAULT gen_random_uuid()`. Child foreign keys are composite `(company_id, <fk>)` referencing `UNIQUE (company_id, id)` on the parent.
- **Money Columns**: `NUMERIC(28,6)`. Never `float4`/`float8`/`double precision`.
- **Account Coherence**: `asset`/`expense` require `normal_side = 'debit'`; `liability`/`equity`/`revenue` require `normal_side = 'credit'` (unless explicitly marked contra with documented normal_side, see §3.4). Codes are normalized (`trim` + collapse internal whitespace) preserving leading zeros (`"001200" !== "1200"`).
- **Journal Balance**: `gl_line` enforces `debit >= 0 AND credit >= 0` and `(debit = 0) <> (credit = 0)` (no signed amount column). `gl_entry` enforces `total_debit = total_credit` plus a `DEFERRABLE INITIALLY DEFERRED` constraint trigger asserting `SUM(gl_line.debit) = SUM(gl_line.credit) = gl_entry.total_debit` at `COMMIT`.
- **Row Accounting & Idempotency**: `import_batch` is unique on `(company_id, kind, source_hash)` for active batches; re-importing the same `source_hash` atomically marks the prior batch `replaced` and commits the replacement with zero duplicates. `COUNT(import_row_raw)` where `status IN ('imported','quarantined')` equals `import_batch.row_count` exactly, and quarantined rows require `quarantine_reason IS NOT NULL`.
- **Append-Only Audit**: `audit_log` computes `entry_hash = sha256(prev_hash || canonical_json(payload))` starting from 64 zero hex chars; triggers forbid `UPDATE` and `DELETE`.

---

## 3. Financial Engine Contracts (M0–M1 — Gates E1–E11)

### 3.1 Money Primitives (`/core/money`)
- Constructed strictly from strings or integer minor units (`money(str)`, `fromMinorUnits(bigintOrInt, scale)`). Constructing from JS `number` floats is rejected.
- Currency display scales: `0` (`JPY`, `KRW`), `2` (`USD`, `EUR`, `GBP`, `INR`, `CAD`, `AUD`, `SGD`, `CHF`), `3` (`KWD`, `BHD`, `OMR`).
- Rounding: internal math retains full precision; rounding (`HALF_UP` default) occurs only at storage (`scale = 6`) or presentation (`currency scale`) boundaries.
- Division: `div(a, b, scale, mode)` requires explicit `scale` and `mode`; `b == 0` returns `null`.
- Serialization: money crosses JSON/API boundaries exclusively as canonical decimal strings.
- Null Law: `null` represents absent data; never coerced to `"0"`.

### 3.2 Amount Parsing (`/core/money/parse.ts`)
- Supported unambiguous formats: `"1,234.56"`, `"(1,234.56)"`, `"1.234,56"`, `"1234.56-"`, `"$ 1,234.56"`, `"1 234,56"`.
- Null tokens (`""`, `"—"`, `"-"`, `"n/a"`, `"N/A"`, `"null"`) return `{ kind: "null" }`.
- Ambiguous inputs (e.g. `"1,234"` without explicit decimal or locale disambiguation) return `{ kind: "quarantine", reason }`.

### 3.3 Largest-Remainder Allocation (`/core/money/allocate.ts`)
- `allocate(amount, buckets[{ key, weight }], scale)`: floors exact shares to `scale`, distributes residual minor units one-by-one to largest fractional remainders, breaking ties by `key` ascending.
- Invariant: `sum(allocated) === amount` exact; negative amounts allocate symmetrically; all-zero weights return a typed error.

### 3.4 Signs & Articulation (`/core/statements`, `/core/invariants.ts`)
- Natural activity: `debit - credit` for debit-normal accounts; `credit - debit` for credit-normal accounts. `Math.abs` is banned.
- Permanent EBITDA Oracle: Revenue `1000`, COGS `400`, OpEx `300` => EBITDA `+300.00`.
- Articulation Invariants (A1–A7):
  - **A1**: Trial Balance `Σdebits == Σcredits` exact; every `gl_entry` balanced.
  - **A2**: P&L `Net Income == Σrevenue(natural) - Σexpense(natural)` tying to TB activity.
  - **A3**: Balance Sheet `Assets == Liabilities + Equity` exact.
  - **A4**: Retained Earnings `closing RE == opening RE + Net Income - distributions`.
  - **A5**: Indirect Cash Flow `ending cash == beginning cash + CFO + CFI + CFF == BS Cash` exact.
  - **A6**: Cross-artifact tie-out `Engine == UI == XLSX == PDF` exact.
  - **A7**: Zero balancing plugs permitted.

### 3.5 Variance & Favorability (`/core/variance`)
- `variance_amount = actual - plan` (natural sign).
- `variance_pct`:
  - `plan == 0 && actual == 0` -> `"0.00%"` (numeric `0`)
  - `plan == 0 && actual != 0` -> `"n/m"` (`null` numeric ratio, status `"nm"`)
  - `plan != 0` -> `div(variance_amount, abs_via_negate_if_negative(plan), scale, HALF_UP)`
- Favorability: derived from account type (`revenue`/`asset`: `actual > plan` favorable; `expense`/`liability`: `actual < plan` favorable).

### 3.6 Fiscal Calendars (`/core/calendar`)
- Deterministically generates periods for `12month`, `445`, `454`, `544`, `52_53` (NRF with explicit W53 rule), and `13x4`. Proven against Q2 NRF 2024–2028 oracle fixtures (including the 53-week year).

---

## 4. Coherent Sample Corpus & Oracles (M0–M1 — Gates C1–C10)

- Generated deterministically by `/fixtures/corpus/generator.ts` from a fixed seed: CoA + Calendar -> Budget -> Registered Deviations -> Derived Actuals -> Balanced GL Postings -> Canonical `answer_key.json`.
- Company labeled `"Sample Co — DEMO — SYNTHETIC DATA"` in UI and exports.
- Independent oracle script (`/scripts/generate-independent-oracles.ts` / `/fixtures/oracles/expected/`) uses integer minor-unit `BigInt` summation with zero imports from `/core`.

---

## 5. UX & Spine Screens (M1 — Gates U1–U10, G1–G10)

Exactly seven screens at M1 exit:
1. `SignInPage` (`/sign-in`)
2. `SetupWizardPage` (`/setup`)
3. `ImportWizardPage` (`/import`)
4. `CoaMapperPage` (`/coa-mapper`)
5. `ModelGridPage` (`/model-grid`)
6. `StatementsPage` (`/statements` — P&L, BS, CF tabs + BvA view)
7. `BoardPackPage` (`/board-pack` — preview + XLSX/PDF export)

Every screen implements all five states (`loading`, `empty`, `error`, `partial`, `populated`), WCAG AA landmarks + single skip-link, exact drill-to-source (`Σrows == displayed`), and zero fabricated values.

---

## 6. M0 Acceptance Criteria Checklist (WI-0001 .. WI-0010)

- [x] **WI-0001 (Scaffold & Repo Layout)**: Exact §3.3 layout, four root docs + pointer files, `.env.example`, `.gitignore`, TypeScript strict config, Vite + Vitest + Playwright config, CI workflow with diagnostic artifact upload.
- [x] **WI-0002 (Process & Integrity Gates + P01–P04)**: `core-purity`, `no-native-deps`, `secret-scan`, `schema-scope`, plus salvaged `money-ast` (P01), `tautology` (P02), `fabrication` (P03), `readme-claims` (P04) — each proven red on a planted violation and green on clean repo.
- [x] **WI-0003 (Typed Error Catalog — P12)**: `/shared/errors.ts` ported from Q2/Q3 with stable codes and user-facing messages + unit tests.
- [x] **WI-0004 (Money Kernel — P05, P06, P07, P08, P20)**: `/core/money` single primitive set, parsing, string serialization, largest-remainder allocation (10,000 seeded cases + oracle fixtures).
- [x] **WI-0005 (Fiscal Calendar Kernel — P09, P10)**: Checksummed Q2 NRF 2024–2028 Class A fixtures + `/core/calendar` generator passing all calendar kinds.
- [x] **WI-0005B (Master Prompt v1.2 Addons & M0 Governance Gates — GOV1–3, LIC1–3, VER1/3, TST1)**: Ratify Parts 11 & 12 (`MASTER_PROMPT.md` v1.2), `/docs/adr`, `CHANGELOG.md`, `LICENSE`, `THIRD_PARTY_LICENSES.md`, `constitution-check`, `license-check`, and `TST1` algebraic property tests.
- [x] **WI-0005C (Master Prompt v1.3 Work-Integrity Codex — INT1–INT13)**: Ratify Part 13 (`MASTER_PROMPT.md` v1.3), `ADR-0003`, `/scripts/work-integrity.mjs` (`S-PLACEHOLDER`, `S-SUPPRESS`, `S-DEAD-CONTROL`, `S-TEST-INTEGRITY`, `S-SWALLOW`, `S-DEBUG`, `S-COMMIT`, `S-CUTLINE`, `S-RATCHET`), `scripts/integrity-ratchet.json`, and verbatim §13.9 attestations.
- [ ] **WI-0006 (Audit Hash Chain — P11)**: `/core/audit` canonical JSON SHA-256 chain + tamper detection tests.
- [ ] **WI-0007 (M1 Schema Migrations on PGLite — D1–D9)**: `0001_m1_spine.sql` with exact 18 tables, composite tenant FKs, deferred balance trigger, append-only audit trigger, schema snapshot, and positive/negative DB tests on PGLite.
- [ ] **WI-0008 (Statements, Variance & Invariants Kernel — P15, P17, P18, P19)**: Class A CoA/statement fixtures + `/core/statements`, `/core/variance`, `/core/invariants` passing EBITDA `+300` and A1–A5.
- [ ] **WI-0009 (Coherent Corpus v1 & Independent Oracles — S6, C1–C4)**: Plan-first deterministic corpus generator, committed artifacts, non-`/core` BigInt oracle verifier, and messy-export fixtures.
- [ ] **WI-0010 (Playwright Spine Harness & `npm run verify` — S2, S7, PR1–PR8)**: End-to-end harness wired, minimal honest app shell mounting the 7 spine route shells in honest states, `npm run verify` green in `< 60s`.
