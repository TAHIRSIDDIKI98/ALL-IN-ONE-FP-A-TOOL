# OneFP&A — Living Specification (SPEC.md)

> Scope: **Current Phase (M2 Planning Suite)** + **Verified Spine (M0–M1)** (MASTER_PROMPT §2.5, §8.1, §8.11; opened by `DEC-014`).
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

### 3.6b Chart of Accounts (`/core/chart`, `account`, `coa_mapping`)
- The chart is the **target** side of every import mapping: a source account code can post only when an `account` row exists for that code; everything else is quarantined `UNMAPPED_ACCOUNT:<code>`.
- Chart CSV columns (header aliases accepted, case-insensitive): `code`, `name`, `type` (`asset|liability|equity|revenue|expense`), `normal_side` (`debit|credit`), `statement_line_key` (catalog keys only), optional `parent_code`, optional `is_postable` (`true/false/yes/no/1/0`, default `true`).
- Codes are normalized (trim + collapse internal whitespace) and leading zeros are preserved: `"001200" != "1200"`.
- Validation is **all-or-nothing** (`/core/chart/parseChartCsv`): every rejected row is reported as `row <n>: <REASON>` and nothing is written. Reason codes: `EMPTY_FILE`, `MISSING_COLUMN:<name>`, `BLANK_ROW`, `EMPTY_CODE`, `EMPTY_NAME`, `DUPLICATE_CODE:<code>`, `INVALID_TYPE:<v>`, `INVALID_NORMAL_SIDE:<v>`, `UNKNOWN_STATEMENT_LINE:<v>`, `EMPTY_PARENT_CODE`, `SELF_PARENT:<code>`, `INVALID_IS_POSTABLE:<v>`.
- Import is idempotent on `(company_id, code)`: re-importing a chart updates rows (bumping `account.version`) and never duplicates; a re-type of an existing code, or a parent that does not exist, is rejected by `seedChartOfAccounts`.
- A type/normal-side mismatch is **not** an error: it is recorded as `is_contra = true` (e.g. accumulated depreciation: `asset` / `credit`).
- The chart import writes its accounts and its `audit_log` row in ONE transaction (G10).

### 3.6c Budget / Plan (`/core/budget`, `scenario`, `plan_version`, `plan_line`)
- A budget is stored as `scenario(kind='budget', name='Budget FY<year>')` -> `plan_version(is_current)` -> `plan_line(account, period, entity, amount)`. Budget amounts **never** enter `gl_entry`: `POST /api/companies/:id/import/commit` refuses every `kind` other than `actuals`, and every actuals read filters batches on `kind = 'actuals'` plus active status.
- Budget CSV columns (header aliases accepted, case-insensitive): `account_code`, `period`, `amount`. `period` accepts `P1`, `p01`, `1`, `01` and is normalized to the canonical `Pnn` code generated by `/core/calendar`; `P01`..`P13` only.
- `amount` goes through the `/core/money` parser (parentheses negatives, currency symbols, thousands separators, `12,5` European decimals); it is stored at the 6-dp storage scale with the sign exactly as supplied. A blank amount is rejected as `NULL_AMOUNT` — a missing plan number is never silently planned as zero.
- Validation is **all-or-nothing** (`/core/budget/parseBudgetCsv`): every rejected row is reported as `row <n>: <REASON>` and nothing is written. Reason codes: `EMPTY_FILE`, `MISSING_COLUMN:<name>`, `BLANK_ROW`, `EMPTY_ACCOUNT_CODE`, `INVALID_PERIOD:<v>`, `DUPLICATE_LINE:<code>/<period>`, `NULL_AMOUNT`, plus the `/core/money` `AMOUNT_*` reasons. Only an accepted row reserves its `(account, period)` key, so one bad row cannot produce a second, misleading duplicate error.
- Repository-level rejections (file parses clean, but the company disagrees): `row <n>: UNMAPPED_ACCOUNT:<code>`, `row <n>: UNKNOWN_PERIOD:<code> (fiscal year <fy>)`, `SCENARIO_NAME_CONFLICT:<name>`.
- Each import creates a NEW `plan_version` (`version_no = max + 1`, label `FY<year> Budget v<n>`) and flips `is_current` on the previous version in the SAME transaction, so history is kept and no plan line is ever duplicated. The `audit_log` row (`budget.import`) commits in that transaction too (G10).
- Reads: `GET /api/companies/:id/budget?year=<fy>` returns `{scenarioId|null, scenarioName|null, planVersionId|null, versionNo|null, lineCount, totalAmount, lines[], accounts[]}`. A company with no budget reports nulls, `0` lines and `0.00` — an honest empty state, never an invented all-zero plan.

### 3.6d Budget-vs-Actual (`/core/variance`, `GET /bva`)
- Reads join the CURRENT plan version (truncated to the periods at or before `?period=`) with the trial-balance actuals through the same period, then call `buildBudgetVariance` in `/core/variance`. The screen never computes a variance the engine did not.
- `varianceAmount = actual - plan`. `variancePct` and favorability follow §3.5 exactly (`0.00%` for 0 vs 0, `n/m` for x vs 0, account-type favorability).
- Zero-base rules: a row is emitted only when the account has a plan line **or** non-zero actual activity; an account with neither is omitted rather than shown as `0 vs 0`. An account with actuals but no plan line keeps `plan: null`, `varianceAmount: null`, `variancePctKind: 'null'`, `favorability: 'na'` — "not planned", never a fabricated zero plan. A planned account with no GL activity is compared against the true `0.00` the trial balance reports for it (data, not a fabrication).
- Totals sum only what exists: `plan` covers planned rows, `varianceAmount` covers rows with both sides, and `unplannedActual` is reported separately so `actual = plannedActual + unplannedActual` is always visible.
- `byType[]` reports actual/plan/variance per account type; its `actual` values ARE the statement figures (G5 tie-out: revenue `byType.actual == pnl.revenue`).

### 3.6e Board Pack Export (`shared/boardPack.ts`, `server/export/boardPack.ts`, `GET /board-pack`)
- The board pack has ONE canonical wire model: `{ companyId, companyName, baseCurrency, range, rows[], articulation, sources, hasPlan, basis, disclosure }`. Every `rows[]` entry is `{ section: cover|pl|bs|cf|bva, key, label, value, detail|null }`; `value` is a canonical decimal STRING already produced by `/core` (or the shared display token `not planned`), and `detail` is composed only from engine-issued strings. The server never computes a new financial number and the browser never formats one into a number (§5.2, A6).
- `key` namespaces are defined once in `shared/boardPack.ts`: `statement:<core field>` for the cover and statement aggregates/leaves, `bva:<account code>` for variance rows. Canonical `statement_line.key` values from `pnl.byKey`/`balanceSheet.byKey` are carried unchanged as `statement:<key>`; labels are presentation only (§4.5).
- `GET /api/companies/:companyId/board-pack?period=&year=` returns that same model, validated by `BoardPackReportSchema`. `GET …/board-pack/export?period=&year=&format=xlsx|pdf` streams an artifact made from the SAME `rows[]`, with `format` constrained by zod and an explicit attachment filename. Unknown format/period, missing period, unauthenticated access and a foreign tenant all return typed errors and write nothing (D2, SEC2, SEC5).
- Preview (the React screen), XLSX and PDF render every row's `label`, `value` and non-null `detail` verbatim. An automated test parses the ACTUAL generated workbook cells and PDF content streams and asserts equality with the JSON rows; no visual inspection and no re-derivation of expectations from the renderer (A6, U5, G7).
- The preview exposes XLSX and PDF buttons that perform real authenticated downloads; the empty state appears with no committed sources, a partial banner appears when articulation fails or unplanned actuals exist, and the error state carries the server's typed code with a retry of the exact failed action. There is no fabricated cover KPI, trend, or demo record (§9.2–§9.3.7, §13.3).

### 3.6f Versioned CoA mapping (`/core/mapping`, `coa_mapping`, `GET/POST /coa-mapping`)

- `coa_mapping` is the SOURCE→target half of G1. Its canonical grain is `(company_id, source_system, source_code, mapping_version)`; M1 sources come from imported CSV text, so `source_system = 'csv'`. Codes are normalized exactly like chart codes (trim + collapse whitespace, preserve case and leading zeros); source code `001200` never becomes account `1200` unless an explicit mapping says so.
- A mapping row is either `mapped(account_id)` or `quarantined(quarantine_reason)`. M1 reason vocabulary: `MANUAL_QUARANTINE`, `NO_TARGET_ACCOUNT`, `AMBIGUOUS_TARGET`. A mapped target must be an active, postable `account` of the same company; a quarantined row must carry a reason. There is no silent discard and no guess.
- Resolution order for every imported source code is defined ONCE in `/core/mapping` and used by both the preview and the commit classifier: (1) newest mapping row with `effective_from <= as_of_date`; (2) a quarantined row quarantines the source row with `QUARANTINED_BY_MAPPING:<reason>`; (3) a mapped row posts to its target account id; (4) with no mapping, exact case-insensitive chart-code match; (5) otherwise `UNMAPPED_ACCOUNT:<source_code>`. Preview and commit of the same source text therefore post identical rows.
- Every edit writes a NEW version (`max(existing) + 1`) effective that day; re-submitting an identical edit is a no-op (idempotent), and each real write plus its old/new payload is chained into `audit_log` in the SAME transaction (G10). One bad entry rejects the whole batch with `row <n>: <REASON>` (`EMPTY_SOURCE_CODE`, `UNKNOWN_SOURCE_CODE:<code>`, `UNKNOWN_ACCOUNT:<code>`, `MISSING_QUARANTINE_REASON`, `DUPLICATE_SOURCE_CODE:<code>`).
- `GET /api/companies/:companyId/coa-mapping?asOfDate=` returns `{ companyId, sourceSystem, effectiveFrom, mappings[], availableAccounts[], mappedCount, quarantinedCount, unmappedCount, conflictCount }`. An unmapped discovery carries display `mappingVersion = 0` (no stored row), never a fabricated version. Source codes are discovered ONLY from retained `import_row_raw` rows (posted `accountCode` or `UNMAPPED_ACCOUNT:<code>` reason), with real row counts and sample values; the target list is the live chart. Two different sources sharing one target are reported as `targetConflict` (yellow), not silently rejected.
- `POST /api/companies/:companyId/coa-mapping/commit` accepts `{ entries: [{ sourceCode, status, accountCode?, quarantineReason? }] }` and returns the same report with `written`/`unchanged` counts. Missing/foreign-tenant sessions return typed errors and write nothing.
- `CoaMapperPage` shows the two panes (discovered source codes with row counts, sample values, status, version and conflict flag; chart targets), inline source→target selection, a typed quarantine picker, "accept all auto" (only exact chart-code matches), "quarantine unmapped", and a real versioned commit. Five states: loading, empty (no imports yet → CTA to import wizard), error (typed code + retry of the exact failed action), partial (unmapped or conflicting rows), populated (every source mapped or explicitly quarantined).

### 3.6 Fiscal Calendars (`/core/calendar`)
- Deterministically generates periods for `12month`, `445`, `454`, `544`, `52_53` (NRF with explicit W53 rule), and `13x4`. Proven against Q2 NRF 2024–2028 oracle fixtures (including the 53-week year).

### 3.7 M2 Planning Engine (`/core/planning`)
- **Driver-Based Plan (`computeDriverPlan`)**: Evaluates typed drivers (`fixed`, `growth_rate`, `percent_of_account`, `price_times_volume`) across an ordered period sequence using `decimal.js` via `/core/money` (storage-scale compounding, currency-scale presentation).
  - Resolves `percent_of_account` dependencies via Kahn's topological sort; rejects cycles (`CYCLE_DETECTED:<codes>`), self-references (`SELF_REFERENCE_DRIVER:<code>`), unknown sources (`UNKNOWN_DRIVER_SOURCE:<driver>-><target>`), duplicate driver accounts, and empty/duplicate periods.
  - Every computed line carries `source: 'driver' | 'override'`, `driverKey`, and `assumptionLabel` (§1.6-4 Honesty Law).
- **Rolling Forecast (`buildRollingForecast`)**: Stitches closed actuals (`period <= cutoffPeriod`) with forecast lines (`period > cutoffPeriod`). Every cell is explicitly tagged `basis: 'actual' | 'forecast'`. Absent cells remain `null` (Null Law §3.1) and are counted in `missingCellCount`; `actualSubtotal + forecastSubtotal == fullHorizonTotal` exact.
- **Forecast cutoff resolution**: `GET /api/companies/:companyId/planning/rolling-forecast?year=&scenario=[&cutoffPeriod=]` treats an **omitted** `cutoffPeriod` as “last posted period”: the server resolves it to the highest `fiscal_period.period_no` of that fiscal year that has a line in an ACTIVE import batch, and reports that code in `cutoffPeriod`. A company with no active postings keeps the pure-forecast horizon (`cutoffPeriod: 'NONE'`, every cell `forecast`). An explicit `cutoffPeriod` is honoured exactly as before, and an unknown code is still a typed `PERIOD_NOT_FOUND` (422).
- **Scenario Comparison (`compareScenarios`)**: Compares `base` vs `target` scenarios account-by-account using §3.5 zero-base rules (`0 vs 0 -> 0.00%`, `x vs 0 -> n/m`). Accounts absent from one scenario keep `null` on that side and `deltaPctStatus: 'null'` — never fabricated as zero.

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

### 5.1 M2 planning views — inside the Model Grid, not new screens (WI-0032)

The §9.1 seven-screen inventory is unchanged at M2. Planning appears as a **view** of the seventh screen (`/model-grid?tab=planning`), exactly as BvA is a view of Statements (`DEC-015`).

- **View switch**: the Model Grid keeps ONE `h1` (“Model Grid”) and one skip link, and exposes `role="tablist"` with `Actuals` and `Planning`. The tab is reflected in `?tab=`; no route is added.
- **Driver-plan authoring (WI-0033)**: `DriverAuthoringPanel` inside `/model-grid?tab=planning` lets users compose multi-driver plans across `fixed`, `growth_rate`, `percent_of_account`, and `price_times_volume` (with optional per-period overrides and per-period P×V grids) targeting real active postable accounts read from `GET /api/companies/:companyId/accounts` (if none exist, a partial banner offers a direct CTA to `/coa-mapper`). Client validation strictly checks string shape only (`buildDriverDefinitions`) with zero monetary arithmetic. **Preview driver plan** executes a dry-run (`POST …/planning/drivers/preview`) and renders `DriverPlanPreviewTable` (`totalsByAccount`, `totalsByPeriod`, `grandTotal`, per-line `source` `'driver' | 'override'`, `driverKey`, and `assumptionLabel`) with zero DB writes; **Commit plan version** saves an audited `plan_version` (`POST …/planning/drivers/commit`) and refreshes the scenario inventory, rolling forecast, and scenario comparison. Server and client validation issues (including `CYCLE_DETECTED`, `SCENARIO_KIND_CONFLICT`, `UNMAPPED_ACCOUNT`) render verbatim in `InlineErrorState` with a single-click retry.
- **Scenario inventory**: every scenario of the company with its kind and its CURRENT plan-version number/label (`no current version` when none). Selecting a row sets the rolling-forecast scenario; a previous selection survives only while that scenario still exists.
- **Rolling forecast**: rendered strictly from `RollingForecastResponse`. Each period header names its basis (`actual` / `forecast`); a `null` cell prints `not posted` (actual basis) or `not planned` (forecast basis) and is never shown as `0`; per-row `missingCellCount` and the horizon `totalMissingCells` are displayed; a scenario with `planVersionNo: null` carries a partial banner stating no plan amount was inferred. The cutoff control defaults to **Automatic — last period with actual postings** (server-resolved, §3.7) and every explicit `Pnn` is selectable.
- **Scenario comparison**: base/target selectors, then the server's `ScenarioComparisonRow`s. `deltaPctStatus: 'zero'` prints the server's zero percent, `'nm'` prints `n/m`, `'null'` prints `not planned` with a comparability column (`not planned in base` / `not planned in target`), and totals are the server's.
- **States**: loading, empty (no scenario, with an Import-Wizard CTA and the driver authoring form below for authenticated workspaces), error (typed code + retry of the exact failed read or authoring action) and partial (missing cells, no current plan version, one scenario only, base = target, or no postable chart accounts) are all explicit; there is no fabricated forecast, percentage, or second scenario. Browser money arithmetic is zero: every amount is a server decimal string (§5.2).

---

## 6. M0 Acceptance Criteria Checklist (WI-0001 .. WI-0010)

- [x] **WI-0001 (Scaffold & Repo Layout)**: Exact §3.3 layout, four root docs + pointer files, `.env.example`, `.gitignore`, TypeScript strict config, Vite + Vitest + Playwright config, CI workflow with diagnostic artifact upload.
- [x] **WI-0002 (Process & Integrity Gates + P01–P04)**: `core-purity`, `no-native-deps`, `secret-scan`, `schema-scope`, plus salvaged `money-ast` (P01), `tautology` (P02), `fabrication` (P03), `readme-claims` (P04) — each proven red on a planted violation and green on clean repo.
- [x] **WI-0003 (Typed Error Catalog — P12)**: `/shared/errors.ts` ported from Q2/Q3 with stable codes and user-facing messages + unit tests.
- [x] **WI-0004 (Money Kernel — P05, P06, P07, P08, P20)**: `/core/money` single primitive set, parsing, string serialization, largest-remainder allocation (10,000 seeded cases + oracle fixtures).
- [x] **WI-0005 (Fiscal Calendar Kernel — P09, P10)**: Checksummed Q2 NRF 2024–2028 Class A fixtures + `/core/calendar` generator passing all calendar kinds.
- [x] **WI-0005B (Master Prompt v1.2 Addons & M0 Governance Gates — GOV1–3, LIC1–3, VER1/3, TST1)**: Ratify Parts 11 & 12 (`MASTER_PROMPT.md` v1.2), `/docs/adr`, `CHANGELOG.md`, `LICENSE`, `THIRD_PARTY_LICENSES.md`, `constitution-check`, `license-check`, and `TST1` algebraic property tests.
- [x] **WI-0005C (Master Prompt v1.3 Work-Integrity Codex — INT1–INT13)**: Ratify Part 13 (`MASTER_PROMPT.md` v1.3), `ADR-0003`, `/scripts/work-integrity.mjs` (`S-PLACEHOLDER`, `S-SUPPRESS`, `S-DEAD-CONTROL`, `S-TEST-INTEGRITY`, `S-SWALLOW`, `S-DEBUG`, `S-COMMIT`, `S-CUTLINE`, `S-RATCHET`), `scripts/integrity-ratchet.json`, and verbatim §13.9 attestations.
- [x] **WI-0006 (Audit Hash Chain — P11)**: `/core/audit` canonical JSON SHA-256 chain + tamper detection tests.
- [x] **WI-0007 (M1 Schema Migrations on PGLite — D1–D9)**: `0001_m1_spine.sql` with exact 18 tables, composite tenant FKs, deferred balance trigger, append-only audit trigger, schema snapshot, and positive/negative DB tests on PGLite.
- [x] **WI-0008 (Statements, Variance & Invariants Kernel — P15, P17, P18, P19)**: Class A CoA/statement fixtures + `/core/statements`, `/core/variance`, `/core/invariants` passing EBITDA `+300` and A1–A5.
- [x] **WI-0009 (Coherent Corpus v1 & Independent Oracles — S6, C1–C4)**: Plan-first deterministic corpus generator, committed artifacts, non-`/core` BigInt oracle verifier, and messy-export fixtures.
- [x] **WI-0010 (Playwright Spine Harness & `npm run verify` — S2, S7, PR1–PR8)**: End-to-end harness wired, minimal honest app shell mounting the 7 spine route shells in honest states, `npm run verify` green in `< 60s`.
