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

Enforced by `/scripts/schema-scope`: any table outside the locked M1 set (and M2 collaboration tables once opened under `DEC-017`) fails the build.

### 2.1b Approved M2 Collaboration Tables (`0002_m2_collaboration.sql`, `DEC-017`)
19. `approval_task` — versioned plan approval state machine (`draft -> submitted -> approved | rejected`) tied to `(company_id, scenario_id, plan_version_id)` with optimistic concurrency `version` and DB trigger transition enforcement.
20. `comment` — plan comments tied to `(company_id, plan_version_id)` and anchored via canonical keys (`version`, `account:<code>`, `cell:<code>:<period>`, `statement:<key>`) backed by composite company-scoped FKs.
21. `job` — typed background/in-process job ledger (`§11.2`) keyed idempotently on `(company_id, kind, idempotency_key)` so duplicate dispatch keys never double-execute.
22. `notification` — company-scoped in-app inbox notifications emitted by `notification.dispatch` jobs for `@mentions` and approval transitions, linked to `job_id`, `plan_version_id`, and `task_id` / `comment_id`.

Migration `0002_m2_collaboration.sql` also expands `membership.role` from `('owner')` to `('owner', 'editor', 'reviewer', 'viewer')` per §4.3 (M2 RBAC expansion).

### 2.1c Approved M2 Workforce Table (`0003_m2_workforce.sql`, `DEC-018`)
23. `workforce_position` — company-scoped headcount and compensation roster (`position_code`, `title`, `department_name`, `account_id`, `start_period_code`, `end_period_code`, `fte`, `annual_salary`, `burden_rate`, `bonus_rate`, `ramp_first_period_pct`, `merit_period_code`, `merit_increase_pct`, `status`, `created_by`) with `NUMERIC(28,6)` financial columns and composite company-scoped FKs to `account(company_id, id)` and `membership(company_id, user_id)`. M3+ module tables (`CapEx`, `Sales`, `Treasury`, `FX`, `Consolidation`) remain blocked.

### 2.1d Approved M2 Connectors Tables (`0004_m2_connectors.sql`, `DEC-020`, `§11.1`, `CON1–CON5`)
24. `connector_config` — company-scoped external data connector definitions (`source_system IN ('google_sheets', 'quickbooks_online', 'xero')`, `name`, `external_ref`, `credential_ref ~ '^vault:sha256:[0-9a-f]{64}$'`, `sync_cursor`, `status IN ('active', 'paused', 'revoked')`, `last_synced_at`, `created_by`) with composite company-scoped FK to `membership(company_id, user_id)`. M3+ ERPs (`NetSuite`, `D365`) and M5 ERPs (`SAP`, `Oracle`) remain strictly blocked.
25. `sync_run` — append/status-tracked connector pull ledger (`mode IN ('incremental', 'full_repull')`, `status IN ('completed', 'replaced', 'quarantined', 'failed')`, `cursor_before`, `cursor_after`, `source_hash`, `rows_pulled`, `rows_imported`, `rows_quarantined`, `total_debits`/`total_credits NUMERIC(28,6)`, `reconciliation_status IN ('matched', 'mismatch_quarantined')`, `reconciliation_reason`, `import_batch_id`, `replaced_run_id`) with SQL `CHECK` guaranteeing `mismatch_quarantined` runs write `status = 'quarantined'`, `import_batch_id IS NULL`, and non-empty `reconciliation_reason`.

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
- `GET /api/companies/:companyId/board-pack?period=&year=` returns that same model, validated by `BoardPackReportSchema`. `GET …/board-pack/export?period=&year=&format=xlsx|pdf|pptx` streams an artifact made from the SAME `rows[]` (`renderXlsx` / `renderPdf` / `renderPptx` via `pptxgenjs`, `LAYOUT_16x9` with paginated section slides and provenance slide), with `format` constrained by zod and an explicit attachment filename (`board-pack-<period>.xlsx|pdf|pptx`). Unknown format/period, missing period, unauthenticated access and a foreign tenant all return typed errors and write nothing (D2, SEC2, SEC5).
- Preview (the React screen), XLSX, PDF and PPTX render every row's `label`, `value` and non-null `detail` verbatim. Automated tests parse the ACTUAL generated XLSX workbook cells, PDF content streams, and OOXML `ppt/slides/slide*.xml` `<a:t>` runs and assert equality with the JSON rows (`NOT_PLANNED` token preservation, multi-slide pagination, provenance, and articulation checks); no visual-only assumption and no re-derivation of expectations from the renderer (A6, U5, G7).
- The preview exposes XLSX, PDF and PPTX buttons that perform real authenticated downloads; the empty state appears with no committed sources, a partial banner appears when articulation fails or unplanned actuals exist, and the error state carries the server's typed code with a retry of the exact failed action. There is no fabricated cover KPI, trend, or demo record (§9.2–§9.3.7, §13.3).

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

### 3.8 M2 Collaboration & Workflow Engine (`/core/workflow`, `§11.9`, `WI-0034`)
- **State Machine (`transitionApprovalTask`)**: Enforces `draft -> submitted -> approved | rejected` in both `/core/workflow` and the `approval_task` PostgreSQL `BEFORE UPDATE` trigger:
  - `draft -> submitted`: requires actor role `owner` or `editor`; clears no decision fields because none exist yet.
  - `submitted -> approved`: requires actor role `owner` or `reviewer`; stamps `decided_by`, `decided_at`, optional `decision_reason`, and locks `plan_version.locked_at`. Terminal state (further transitions return `409 MODEL_VERSION_LOCKED`).
  - `submitted -> rejected`: requires actor role `owner` or `reviewer` and a non-empty `reason` (blank reason returns `422 VALIDATION_FAILED`). Terminal state for that `plan_version`; revisions commit a new `plan_version` (`v2+`).
  - Disallowed edges (`draft -> approved`, `draft -> rejected`, `submitted -> draft`, `rejected -> *`, `approved -> *`) return typed errors without DB mutation (`COL1`).
  - Stale `expectedVersion` on transition fails with `409 MODEL_VERSION_LOCKED` (`CC1`).
- **Canonical Comment Anchors (`buildCommentAnchorKey`)**: Anchors every comment strictly to a `plan_version` plus one canonical scope:
  - `version` -> `anchorKey = "version"`
  - `account` -> `anchorKey = "account:<accountCode>"` (composite FK to active/existing company `account`)
  - `cell` -> `anchorKey = "cell:<accountCode>:<periodCode>"` (composite FKs to company `account` + non-adjustment `fiscal_period`)
  - `statement_line` -> `anchorKey = "statement:<statementLineKey>"` (FK to `statement_line.key`)
- **`@Mentions` & Job-Backed Notifications (`extractMentionTokens`, `dispatchNotificationJob`)**:
  - Mentions starting at whitespace or string start (`@email` or unambiguous `@localpart`) resolve strictly against company `membership` + `app_user`; unknown or ambiguous `@mentions` fail whole with `422 VALIDATION_FAILED` (`UNKNOWN_MENTION:*` / `AMBIGUOUS_MENTION:*`) and write nothing.
  - Every comment with `@mentions` and every approval transition (`submitted` / `approved` / `rejected`) executes a synchronous sandbox `job` (`kind = 'notification.dispatch'`, deduplicated on `(company_id, kind, idempotency_key)`), inserts `notification` inbox rows, and appends `audit_log` rows for both the workflow mutation and `job.completed` in ONE DB transaction (`COL3`, `JOB1`, `JOB3`).

### 3.9 M2 Workforce Module (`/core/workforce`, `§2.4 One-Engine Proof`, `WI-0035`)
- **Declarative Module Contract (`WORKFORCE_MODULE_SPEC`)**: Declares module metadata (`moduleKey: 'workforce'`, `dimensions: ['department', 'position', 'account']`, `driverKinds: ['fixed']`, schema-validated `inputColumns`, `recommendedStatementLineKeys`, `reportPackSections`) as configuration/data rather than a separate financial engine (§2.4).
- **One-Engine Compensation Compiler (`compileWorkforceModuleToDrivers`)**:
  - Computes active period base pay (`(annualSalary * fte / periodsInYear) * rampFirstPeriodPct * (1 + meritIncreasePct)` when `period >= meritPeriodCode`), employer burden (`basePay * burdenRate`), and bonus (`basePay * bonusRate`) strictly via `/core/money` (`HALF_UP` at currency display scale), enforcing non-negative values, valid period bounds (`END_BEFORE_START`, `UNKNOWN_START_PERIOD`, `UNKNOWN_END_PERIOD`, `UNKNOWN_MERIT_PERIOD`), ramp bounds (`RAMP_OUT_OF_RANGE`), unique `position_code`, and at least one active position (`NO_ACTIVE_POSITIONS`).
  - Aggregates active position costs by `(accountCode, periodCode)` into `FixedDriverDefinition[]` (`driverKey = "wf_<accountCode>"`) and executes `/core/planning#computeDriverPlan`, guaranteeing `grandTotalCost == driverPlan.grandTotal` to the cent without duplicate calculation logic.
- **API & Atomic Persistence (`shared/workforce.ts`, `server/db/repositories/workforce.ts`, `server/app.ts`)**:
  - `GET /api/companies/:companyId/workforce?year=` returns `WORKFORCE_MODULE_SPEC`, company fiscal periods, active expense/COGS accounts, persisted roster positions, and actor role.
  - `POST /api/companies/:companyId/workforce/positions` (`owner`/`editor`) validates and atomically replaces the company `workforce_position` roster with chained `audit_log` (`workforce.save`).
  - `POST /api/companies/:companyId/workforce/preview` computes dry-run payroll breakdowns + `FixedDriverDefinition[]` + `driverPlan` without DB mutation.
  - `POST /api/companies/:companyId/workforce/commit` (`owner`/`editor`) validates, optionally saves the roster, compiles drivers, and commits directly into `scenario` -> `plan_version` -> `plan_line` via `commitDriverPlan` (so `RollingForecast` and `BvA` tie out to the cent).

### 3.10 M2 Flux Analysis Waterfall Bridge & PVM Decomposition Bridge (`/core/variance`, `WI-0036`)
- **Material Flux Waterfall (`analyzeFlux`)**: Consumes BvA rows from `/core/variance#buildBudgetVariance`, filters planned rows by `absVarianceAmount >= minAbsVariance` (magnitude computed via sign inversion without `Math.abs` / `.abs()`), ranks deterministically by `absVarianceAmount` descending then `accountCode` ascending, caps at `topN`, and computes `shareOfAbsVariancePct = abs(varianceAmount) / totalAbsPlannedVariance * 100` (`0.00%` when total magnitude is zero).
  - Exact waterfall tie-out: `planTotal + topDriversVariance + otherPlannedVariance == plannedActualTotal` (`tieOutValid: true` exact in `/core/money`). Unplanned accounts with GL activity (`plan === null`) are disclosed separately (`unplannedAccounts`, `unplannedActualTotal`) and summed alongside planned actuals into `actualTotal` (`actualTotal = plannedActualTotal + unplannedActualTotal`) without fabricating zero plans.
  - Rejects `NEGATIVE_THRESHOLD:minAbsVariance`, invalid decimal thresholds (`INVALID_THRESHOLD:minAbsVariance`), and invalid `INVALID_TOP_N` cleanly with zero writes.
- **Price-Volume-Mix Decomposition Bridge (`buildPvmBridge`)**: Validates editable SKU/segment rows (`key`, `label`, `planUnits`, `planPrice`, `actualUnits`, `actualPrice`) via canonical decimal string rules (`DUPLICATE_ITEM_KEY`, `NEGATIVE_UNITS`, `INVALID_UNITS`, `INVALID_PRICE`, `EMPTY_ITEMS`), runs `/core/variance#computePvmDecomposition` with deterministic largest-remainder residual allocation at currency scale, and checks `verifyPvmInvariant` (`priceVariance + volumeVariance + mixVariance == totalVariance`, `invariantDelta: "0"`). Zero-plan revenue emits `variancePct: "n/m"` (`variancePctStatus: "nm"`); zero vs zero emits `"0.00%"` (`"zero"`).
- **API & Shared Contracts (`shared/variance.ts`, `server/db/repositories/variance.ts`, `server/app.ts`)**:
  - `GET /api/companies/:companyId/variance/flux?period=[&year=][&scenarioId=][&minAbs=][&topN=]` returns `FluxAnalysisResponseSchema` scoped to the requesting company.
  - `POST /api/companies/:companyId/variance/pvm` validates `PvmBridgeRequestSchema`, checks active period/year bounds and optional scenario ownership, and returns `PvmBridgeResponseSchema` read-only with company currency precision.

### 3.11 M2 Dashboards v1, KPI Library & Report Builder (`/core/metrics`, `§11.5`, `WI-0038`)
- **Single-Definition KPI Catalog (`METRIC_DEFINITIONS`, `RPT1`, `K3`)**: Defines every canonical financial metric once in `/core/metrics` (`{ key, label, category, formula, unit, format, basis, boardPackKey?, sourceKeys, phase: 'M2' }`) across 18 KPIs (`profitability`, `cash`, `balance_sheet`, `plan`). Both `evaluateKpiLibrary` and Board Pack cover KPI rows (`server/export/boardPack.ts`) evaluate directly from this single catalog (`RPT1`), eliminating formula drift across dashboards, PDF/XLSX/PPTX exports, and the Report Builder.
- **Zero-Base & Scale Discipline**: Evaluates margins (`pnl.gross_margin`, `pnl.ebitda_margin`, `pnl.net_margin`), ratios (`pnl.opex_ratio`, `cf.cash_conversion`, `bs.liabilities_to_equity`), and plan attainments (`plan.revenue_attainment`, `plan.ebitda_attainment`) strictly via `/core/money#div(..., 'HALF_UP')`. Zero denominators emit `{ formattedValue: 'n/m', status: 'nm', numericValue: null }`, and an absent budget plan emits `{ formattedValue: 'not planned', status: 'not_planned', numericValue: null }` rather than an inferred zero target.
- **Multi-Period Trend Scaling (`buildKpiTrendSeries`)**: Aggregates single-period Revenue, EBITDA, Net Income, and Operating Cash Flow alongside cumulative Ending Cash from committed active GL batches across elapsed fiscal periods (`P01..throughPeriod`), normalizing bar percentages (`0..100`) and polarity flags (`ebitdaPositive`, `cashPositive`) in pure `Decimal` math inside `/core/metrics`.
- **Report Builder Citation Enforcement (`REPORT_TEMPLATES`, `buildReportBlocks`, `RPT4`)**: Composes report templates (`executive_summary`, `cash_and_runway`, `plan_performance`) from `metric` (`pnl.*`, `cf.*`, `bs.*`, `plan.*`) and `statement_line` (`pl.*`, `bs.*`) blocks. Rejects unknown citation keys (`UNKNOWN_REPORT_CITATION:<kind>:<key>`) and guarantees `citedBlockCount === blockCount`, `unlinkedBlockCount === 0`, and `citationCoveragePct === '100.00%'`.
- **Fingerprint-Invalidated Aggregate Cache (`MetricsAggregateCache`, `RPT2`)**: `server/db/repositories/dashboards.ts` keys in-memory per-company summary caches by `(companyId, throughPeriodCode, fiscalYear, templateId, fingerprint)` where `fingerprint` is a SHA-256 hash (`sha256Hex(canonicalJson(...))`) over active `import_batch` records, active `account` versions/count, and current `plan_version` state. Any GL batch commit/replace, chart/CoA edit, or plan/budget commit deterministically changes the fingerprint so stale summaries are never served; cached payloads always equal uncached engine output bit-for-bit.
- **API Endpoint (`GET /api/companies/:companyId/dashboards`)**: Requires `?period=` (optional `&year=`, `&template=`), enforces `requireCompanyActor`, and returns `DashboardSummaryResponseSchema` (`shared/dashboards.ts`) with zero client-side financial arithmetic.

### 3.12 M2 Data-Only Industry Packs (`/core/packs`, `§6.6`, `P23`, `WI-0039`)
- **First 3 M2 Data-Only Packs (`M2_INDUSTRY_PACK_KEYS`)**: Ports Q2 `packs/` schema (`fixtures/packs/schema/pack.schema.json`), Class A SHA-256 checksum manifest (`fixtures/packs/CHECKSUMS.json`, `22` files), and strictly the first three data-only industry packs (`saas`, `retail`, `manufacturing`). Remaining packs stay behind the M4 cut line (`§6.6`).
- **Schema & Executable Rejection (`validateIndustryPackBundle`)**: Validates every pack bundle in `/core/packs` against the schema rules (`schema_version === '1.0.0'`, exact key match, strict non-empty arrays, normalized non-empty CoA codes preserving leading zeros, zero duplicate CoA codes). Any `seed_sql` or executable payload rejects immediately with `PACK_EXECUTABLE_DISALLOWED:manifest.seed_sql`.
- **Canonical Chart Compilation (`compilePackToChartAccounts`)**: Maps Q2 account types (`cogs` / `opex` -> `expense`) onto OneFP&A canonical types (`asset`, `liability`, `equity`, `revenue`, `expense`), derives `normalSide`, and assigns canonical `statement_line.key` values (`pl.revenue`, `pl.cogs`, `pl.opex`, `bs.cash`, `bs.ar`, `bs.ap`, `bs.retained_earnings`, etc.) with `isPostable: true`. All template targets, targets ratios, bounds, and KPI thresholds cross the wire strictly as canonical strings (`shared/packs.ts`).
- **API & Atomic Apply (`server/db/repositories/packs.ts`, `server/app.ts`)**: `GET /api/companies/:companyId/packs` verifies SHA-256 fixture checksums and returns the 3 validated packs with compiled CoA previews, driver templates, KPI definitions, and layouts. `POST /api/companies/:companyId/packs/:packKey/apply` requires `owner` or `editor` role (`canActorCreateTask`), rejects unknown/deferred keys with `404 NOT_FOUND`, applies the compiled CoA atomically & idempotently via `seedChartOfAccounts` (bumping `version` on re-apply with zero duplicates), and appends a chained `pack.apply` record to `audit_log`.

### 3.13 M2 Connectors Framework & Adapters (`/core/integrations`, `§11.1`, `CON1–CON5`, `WI-0040`)
- **Single-Path Canonical Normalization (`CON1`)**: `normalizeConnectorPayload` adapts `google_sheets` (flat tabular export), `quickbooks_online` (`JournalEntry` Debit/Credit lines with Department/Class dimensions), and `xero` (`ManualJournal` signed `LineAmount` with Tracking dimensions) into ONE canonical entry contract (`{ source_system, entry_ref, entry_date, period, currency, lines: [{ account_code, description, debit, credit, dims }], source_row_hash }`, leading zeros preserved) via `/core/money` and `sha256Hex(canonicalJson(...))`. Matched runs project via `normalizedEntriesToImportCsv` straight into `commitImport` — never a parallel GL ingestion path.
- **Reconciliation & Quarantine (`CON3`)**: `reconcileNormalizedBatch` checks batch currency parity against company base currency, expected row count equality when provided, and entry/batch debit == credit balance (`HALF_UP` at currency display scale). Mismatches return `{ matched: false, reasons }` and record `sync_run` with `status = 'quarantined'`, `reconciliation_status = 'mismatch_quarantined'`, `import_batch_id = NULL`, and chained `connector.sync_quarantined` `audit_log` while leaving `import_batch` and GL postings untouched.
- **Incremental Cursor & Full Repull Replacement (`CON2`)**: Incremental syncs store cursor transitions and atomically retire prior matching `source_hash` runs; `full_repull` atomically marks prior completed `sync_run`s and superseded `import_batch`es `'replaced'` inside one DB transaction so repeated pulls produce zero duplicate postings.
- **Write-Only Secret Hygiene (`CON4`)**: `createConnector` hashes incoming `credentialSecret` into `vault:sha256:<64-hex>` before persistence and never selects, returns, logs, or audits `credentialSecret` or `credential_ref`.
- **Fixture Oracles (`CON5`)**: Class A SHA-256 checksummed connector fixtures (`fixtures/oracles/connectors/CHECKSUMS.json`: `google_sheets_gl.json`, `quickbooks_online_je.json`, `xero_manual_journals.json`, `reconciliation_mismatch_je.json`, `connectors_expected.json`) pin canonical normalization, CSV projection, and mismatch verdicts.
- **API & RBAC (`shared/integrations.ts`, `server/db/repositories/connectors.ts`, `server/app.ts`)**: `GET /api/companies/:companyId/connectors`, `POST /api/companies/:companyId/connectors` (`owner`/`editor`, `409 DUPLICATE_CODE` on duplicate `(sourceSystem, name)`), `GET /api/companies/:companyId/connectors/:connectorId/runs`, and `POST /api/companies/:companyId/connectors/:connectorId/sync` (`owner`/`editor`; source mismatch -> `422 VALIDATION_FAILED`, quarantined reconciliation -> `200` `sync_run(status='quarantined')`).

### 3.14 M2 Customer Onboarding & Data Migration Pipeline (`/core/onboarding`, `§11.12`, `ONB1–ONB3`, `WI-0042`)
- **Single-Engine Validation & Row Accounting (`analyzeOnboardingValidation`, `ONB2`)**: Reuses `/core/import` and `/core/mapping` (`classifyImport`) inside `validateCompanyOnboarding` so partner CSV exports undergo exact row accounting (`rowsIn === importableCount + quarantinedCount`), balanced-entry & calendar checks, quarantine category histograms, interior fiscal-period gap detection, leading-zero collision detection, and `Decimal` 10x-median outlier flags labeled `"Potential exception — review"`.
- **Deterministic Assisted CoA Matching (`suggestCoaMappings`, `ONB1`)**: Matches discovered unmapped partner codes against active postable chart accounts via exact code match, unique leading-zero alias, and source-weighted deterministic keyword overlap (`Zero LLM inference at M2`, `ambiguous_leading_zero` never auto-guesses). Every suggestion sets `requiresHumanApproval: true` and never writes to `coa_mapping` until `POST …/onboarding/mappings/approve` commits immutable versioned `coa_mapping` rows + `audit_log` via `planMappingVersions`.
- **Repeatable Cutover Rehearsal (`rehearseCompanyOnboarding`, `ONB3`)**: `POST …/onboarding/rehearse` supports non-destructive `dry_run` (`200`, `committed: null`, zero GL writes, projected post-cutover trial balance excluding any batch with matching `sourceHash`) and transactional `stage_commit` (`201`, blocked with `422 VALIDATION_FAILED` if `goLiveStatus === 'blocked'`, otherwise runs `commitImport` + chained `onboarding.cutover_rehearsal` `audit_log` entry). Identical datasets + mappings emit identical SHA-256 `rehearsalHash` fingerprints and balanced post-TB totals across dry-runs and repeated atomic replacements.
- **API & RBAC (`shared/onboarding.ts`, `server/db/repositories/onboarding.ts`, `server/app.ts`)**: `POST /api/companies/:companyId/onboarding/validate`, `POST /api/companies/:companyId/onboarding/mappings/approve`, and `POST /api/companies/:companyId/onboarding/rehearse` enforce `6mb` import ceiling (`5,000,000` bytes `IMPORT_FILE_TOO_LARGE`), `owner`/`editor` RBAC (`403 TENANT_FORBIDDEN` for `viewer`/foreign tenant), and `401 SESSION_REQUIRED` unauthenticated.

### 3.15 M2 End-User Guidance, Temporal & Localization Contracts (`/core/calendar`, `/shared/temporal`, `/shared/guidance`, `WI-0043`)
- **Temporal Separation & UTC Boundary Rules (`§12.1 TMP1–TMP4`)**:
  - `db/migrations/*.sql` enforces `timestamptz` across all timestamp columns (`0` `WITHOUT TIME ZONE` / `LOCALTIME` / `LOCALTIMESTAMP` columns).
  - `/core/calendar#resolvePeriodForCutoff` accepts explicit strict UTC ISO-8601 instants (`Z`-suffixed) and explicit per-period close cutoff rules (never reading implicit local wall-clock `new Date()`), rolling post-cutoff or closed instants forward sequentially to the next open regular period (`CUTOFF_NO_NEXT_OPEN_PERIOD` when exhausted).
  - `/shared/temporal.ts` isolates `PeriodDateSchema` (`YYYY-MM-DD`) from `UtcInstantSchema` (`YYYY-MM-DDTHH:MM:SSZ`) with branded types so boundary mixing fails validation immediately, and validates IANA display timezones (`DisplayTimeZoneSchema`) for presentation-only formatting (`formatUtcInstantForDisplay`) without altering ledger figures or dates.
- **Localization & Currency Display Precision (`§12.2 LOC1–LOC4`)**:
  - `/shared/guidance.ts` maintains 100% key parity across `en-US`, `ar-SA` (RTL), and deterministic `pseudo` (`I18N_MESSAGE_KEYS`), verifiable via `getMissingTranslationKeys` and `getTranslationCoverage`.
  - `formatLocalizedCurrencyDisplay` formats canonical server decimal strings via exact string decomposition + `BigInt` integer grouping (`Intl.NumberFormat` with ISO decimal precision `0` for JPY/KRW, `2` for USD/EUR, `3` for KWD/BHD/OMR) with zero JS float arithmetic.
  - `/core/calendar#formatLocalizedPeriodLabel` localizes fiscal month labels through `Intl.DateTimeFormat(..., { timeZone: 'UTC' })` without hardcoded English month arrays (`LOC4`).
- **Completable First-Company Onboarding Checklist & Doc Sync (`§11.16 DOC1–DOC3`)**:
  - `GET /api/companies/:companyId/onboarding/checklist` derives real step readiness from persisted `fiscal_period`, active postable `account`, active `actuals` `import_batch`, current `plan_version`, and `audit_log` (`onboarding.checklist_signoff`) rows.
  - `POST /api/companies/:companyId/onboarding/checklist/signoff` enforces `owner`/`editor` RBAC, blocks sign-off (`422 VALIDATION_FAILED`) while prerequisites remain incomplete, appends a chained `audit_log` entry atomically, and replays idempotently once signed off.
  - `scripts/generate-docs.mjs` (`--write` / `--check`) derives `/docs/user-guide/{README.md,reference.md,manifest.json}` deterministically from `SPEC.md` with SHA-256 digests and banned-claim enforcement (`DOC2`).

---

## 4. Coherent Sample Corpus & Oracles (M0–M2 — Gates C1–C10, TST5)

- **Corpus v1 (Tenant A)**: Generated deterministically by `/fixtures/corpus/generator.ts` from seed `202601`: CoA + Calendar (`12month`) -> Budget -> Registered Deviations -> Derived Actuals -> Balanced GL Postings -> Canonical `answer_key.json`. Company labeled `"Sample Co — DEMO — SYNTHETIC DATA"` in UI and exports.
- **M2 Corpus v2 (Tenant B + M2 Domains, `WI-0041`)**: Generated deterministically by `/fixtures/corpus/m2_generator.ts` from seed `202602` (`fixtures/corpus/m2_corpus.json` + `m2_answer_key.json`): Tenant B `"Northstar Manufacturing — DEMO — SYNTHETIC DATA"` on an NRF `454` fiscal calendar preserving distinct leading-zero account codes (`"001400"` alongside `"1400"`), two-year opening balance sheet + FY2026 balanced GL journals, Rolling Forecast horizon (`P06` cutoff), multi-scenario driver plans (`Base Budget`, `Upside Forecast`, `Downside Case` with zero-base `n/m` and `0.00%` cases), and Workforce roster (5 active positions with ramp/merit/attrition + 1 inactive excluded). Proven end-to-end through PGLite DB persistence (`commitImport`, `getTrialBalance`, `getFinancialStatements`, `commitDriverPlan`, `getScenarioComparison`, `commitWorkforcePlan`, `createApprovalTask`, `createConnectorConfig`) with strict `TST5`/`D2` cross-tenant isolation and `403 TENANT_FORBIDDEN` enforcement.
- **Independent Oracles**: `/scripts/generate-independent-oracles.ts` produces `/fixtures/oracles/expected/corpus_expected.json` and `/fixtures/oracles/expected/m2_corpus_expected.json` strictly via integer minor-unit `BigInt` arithmetic with zero imports from `/core`.

---

## 5. UX & Spine Screens (M1 — Gates U1–U10, G1–G10)

Exactly seven screens at M1 exit:
1. `SignInPage` (`/sign-in`)
2. `SetupWizardPage` (`/setup`)
3. `ImportWizardPage` (`/import` — Actuals CSV import, Budget CSV import, M2 ConnectorsPanel (`Google Sheets`, `QuickBooks Online`, `Xero`), and M2 OnboardingPipelinePanel inside one 4-option dataset selector)
4. `CoaMapperPage` (`/coa-mapper` — CoA mapping, chart import, and M2 Industry Pack Catalog panel inside the screen)
5. `ModelGridPage` (`/model-grid`)
6. `StatementsPage` (`/statements` — P&L, BS, CF tabs + BvA + Flux & PVM views)
7. `BoardPackPage` (`/board-pack` — preview + XLSX/PDF/PPTX export)

Every screen implements all five states (`loading`, `empty`, `error`, `partial`, `populated`), WCAG AA landmarks + single skip-link, exact drill-to-source (`Σrows == displayed`), and zero fabricated values.

### 5.1 M2 planning views — inside the Model Grid, not new screens (WI-0032)

The §9.1 seven-screen inventory is unchanged at M2. Planning appears as a **view** of the seventh screen (`/model-grid?tab=planning`), exactly as BvA is a view of Statements (`DEC-015`).

- **View switch**: the Model Grid keeps ONE `h1` (“Model Grid”) and one skip link, and exposes `role="tablist"` with `Actuals` and `Planning`. The tab is reflected in `?tab=`; no route is added.
- **Driver-plan authoring (WI-0033)**: `DriverAuthoringPanel` inside `/model-grid?tab=planning` lets users compose multi-driver plans across `fixed`, `growth_rate`, `percent_of_account`, and `price_times_volume` (with optional per-period overrides and per-period P×V grids) targeting real active postable accounts read from `GET /api/companies/:companyId/accounts` (if none exist, a partial banner offers a direct CTA to `/coa-mapper`). Client validation strictly checks string shape only (`buildDriverDefinitions`) with zero monetary arithmetic. **Preview driver plan** executes a dry-run (`POST …/planning/drivers/preview`) and renders `DriverPlanPreviewTable` (`totalsByAccount`, `totalsByPeriod`, `grandTotal`, per-line `source` `'driver' | 'override'`, `driverKey`, and `assumptionLabel`) with zero DB writes; **Commit plan version** saves an audited `plan_version` (`POST …/planning/drivers/commit`) and refreshes the scenario inventory, rolling forecast, and scenario comparison. Server and client validation issues (including `CYCLE_DETECTED`, `SCENARIO_KIND_CONFLICT`, `UNMAPPED_ACCOUNT`) render verbatim in `InlineErrorState` with a single-click retry.
- **Scenario inventory**: every scenario of the company with its kind and its CURRENT plan-version number/label (`no current version` when none). Selecting a row sets the rolling-forecast scenario; a previous selection survives only while that scenario still exists.
- **Rolling forecast**: rendered strictly from `RollingForecastResponse`. Each period header names its basis (`actual` / `forecast`); a `null` cell prints `not posted` (actual basis) or `not planned` (forecast basis) and is never shown as `0`; per-row `missingCellCount` and the horizon `totalMissingCells` are displayed; a scenario with `planVersionNo: null` carries a partial banner stating no plan amount was inferred. The cutoff control defaults to **Automatic — last period with actual postings** (server-resolved, §3.7) and every explicit `Pnn` is selectable.
- **Scenario comparison**: base/target selectors, then the server's `ScenarioComparisonRow`s. `deltaPctStatus: 'zero'` prints the server's zero percent, `'nm'` prints `n/m`, `'null'` prints `not planned` with a comparability column (`not planned in base` / `not planned in target`), and totals are the server's.
- **States**: loading, empty (no scenario, with an Import-Wizard CTA and the driver authoring form below for authenticated workspaces), error (typed code + retry of the exact failed read or authoring action) and partial (missing cells, no current plan version, one scenario only, base = target, or no postable chart accounts) are all explicit; there is no fabricated forecast, percentage, or second scenario. Browser money arithmetic is zero: every amount is a server decimal string (§5.2).
- **Collaboration & Workflow panel (`WI-0034`)**: `WorkflowPanel` inside `/model-grid?tab=planning` lets workspace members create/submit/approve/reject `approval_task` records for real committed `plan_version`s (with rejection reasons and optimistic concurrency), post anchored comments with `@mentions` (`version`, `account`, `cell`, `statement_line`), view & acknowledge in-app inbox notifications emitted by notification jobs, and (for owners) add workspace members (`owner`, `editor`, `reviewer`, `viewer`). Zero extra routes or screens are added (`DEC-015`).
- **Workforce module panel (`WI-0035`)**: `WorkforcePanel` inside `/model-grid?tab=planning` lets `owner`/`editor` members author the headcount & compensation roster (`positionCode`, `title`, `departmentName`, expense `accountCode`, `startPeriodCode`/`endPeriodCode`, `fte`, `annualSalary`, `burdenRate`, `bonusRate`, `rampFirstPeriodPct`, `meritPeriodCode`/`meritIncreasePct`, `status`), save roster positions (`POST …/workforce/positions`), run dry-run payroll compilation previews (`POST …/workforce/preview`) displaying server-computed position/department summaries & compiled fixed drivers, and commit payroll directly into scenarios/Rolling Forecast/BvA (`POST …/workforce/commit`), with zero client money math and all five UI states (`loading`, `empty`, `error`, `partial`, `populated`) while preserving the 7-screen invariant (`DEC-015`).

### 5.2 Flux Waterfall & PVM Bridge view — inside Statements, not a new screen (WI-0036)
- `FluxPvmPanel` mounts as the `Flux & PVM` tab inside `StatementsPage` (`/statements?tab=flux`), keeping the §9.1 seven-screen inventory unchanged (`DEC-015`) with a single `h1` (“Financial Statements”) and zero browser monetary arithmetic.
- **Material Flux Waterfall Bridge**: Exposes `Min |variance|` and `Top N` (`3 | 5 | 10 | 25`) filter controls backed by `GET …/variance/flux`, a 6-metric waterfall strip (`planTotal`, `topDriversVariance`, `otherPlannedVariance`, `plannedActualTotal`, `unplannedActualTotal`, `netOperatingVariance`), explicit tie-out verification (`Tie-out valid` / `Tie-out failed`), ranked driver table with share of total absolute variance and account-type favorability, and a separate unplanned-actuals table + partial banner when `unplannedAccounts.length > 0`.
- **PVM Decomposition Bridge**: Editable segment table (`Segment Key`, `Label`, `Plan Units`, `Plan Price`, `Actual Units`, `Actual Price`) validated client-side strictly by decimal string shape (`buildPvmBridgeItemsPayload` in `src/state/planningView.ts`) and evaluated server-side via `POST …/variance/pvm`, displaying the 6-card PVM summary, invariant verification line (`Price + Volume + Mix = Total Variance`, `Delta`), itemized segment table, and honest loading/empty/error/partial/populated states.

### 5.3 Dashboards & KPIs view — inside Statements, not a new screen (WI-0038)
- `DashboardsPanel` (`src/components/DashboardsPanel.tsx`) mounts as the `Dashboards & KPIs` tab inside `StatementsPage` (`/statements?tab=dashboards`), preserving the §9.1 seven-screen invariant (`DEC-015`) with a single `h1` (“Financial Statements”) and zero browser monetary arithmetic.
- Renders a 4-card headline KPI strip (`pnl.revenue`, `pnl.ebitda`, `pnl.net_income`, `cf.ending_cash`), an SVG multi-period Revenue/EBITDA/Ending Cash bar trend with accompanying table, a category- and keyword-filterable 18-KPI library table (`All KPIs`, `Profitability`, `Cash & Liquidity`, `Balance Sheet`, `Plan & Variance`), a template-switchable Report Builder citing every block (`100.00% cited`, `0 unlinked`), and explicit loading/empty/error/partial/populated states (no telemetry/cache status exposed in UI).

### 5.4 In-App Contextual Help, RTL Shell & Onboarding Checklist (`WI-0043`)
- `HelpGuidanceDrawer` (`src/components/HelpGuidanceDrawer.tsx`) toggles from the top banner (`Help & Guide`) inside `src/App.tsx` without adding extra routes (`DEC-015`), omitting `<h1>` elements and returning `null` while closed so every route keeps `1` `h1`, `1` skip link, `4` landmarks, and exact `?state=loading` `[role="status"]` uniqueness.
- Displays keyed contextual help (`data-help-key="help.screen.<id>"`) for all 7 screens, switches workspace `displayLocale` (`en-US`, `ar-SA` setting `dir="rtl"`, `pseudo`) and `displayTimeZone` (`UTC`, `America/New_York`, `Europe/London`, `Asia/Tokyo`), and binds the live 5-step onboarding checklist with real prerequisite links and owner/editor audited sign-off (`Complete Onboarding`).

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
