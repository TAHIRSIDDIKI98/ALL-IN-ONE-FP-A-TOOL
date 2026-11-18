# 11 — UAE single-user V1 and mandatory native Excel integration

**Status:** Draft; scope amended by documents 14–15 v0.3 · **Date:** 18 November 2026 · **Owner:** User / solo builder · **Approval:** User-confirmed requirements only; implementation/accounting details proposed.

## Confirmed vs assumed
**Confirmed:** UAE target; single user; native 64-bit Office 2021 Excel add-in and true consolidation are V1 must-haves; solo AI-assisted builder has a Windows test machine and unlimited tokens; a senior from Al Ghurair Group will test the product. Both websites are within the user-provided group coverage. This does not establish exact legal entity/ownership perimeter, working hours, Excel license/edition/build, mainland vs free zone, accounting policy, SME budget or hardware capacity. Do not treat them as confirmed. Security and finance review remain essential, even if a second AI can perform preliminary review. Unlimited tokens do not guarantee correctness.

**Default proposal for discussion:** AED, English UI, configurable Gregorian monthly fiscal year, multiple UAE reporting entities/business units, and accrual accounting when approved. See docs 14–15 and 19: management view alone does not satisfy the required consolidation. Arabic UI is later unless required. Multi-entity consolidation is mandatory, and FX translation needs an approved policy wherever applicable to its perimeter. Company jurisdiction, entity legal form and VAT/CT status are explicitly user-configured; the system does not infer them from UAE location.

## UAE product definition
The first UAE deliverable is a finance planning and analysis tool, **not tax-filing software**. Supporting IFRS-style model templates does not establish IFRS compliance or substitute for professional judgment.

### U-01: local format and calendar
- Configure fiscal-year start, time zone and presentation; store dates/numbers locale-invariant, display AED with explicit decimal scale and number formats. Import date/decimal formats are selected, not inferred when ambiguous.
- Set default currency AED; source/report currencies and any non-AED actuals are explicit. Multi-currency translation is not in this release unless approved separately.
- Save example UAE chart of accounts and synthetic AED data; adapt categories by customer, never silently assume their chart or tax classification.

### U-02: VAT planning, user-driven only
- Input user-reviewed VAT assumptions by period: opening VAT receivable/payable; eligible output/input VAT amounts or explicit rates and calculation base; settlement date and cash assumption. Specify tax-inclusive/exclusive basis; exemptions, zero-rating, reverse charge, blocked recovery and sector rules are not guessed.
- Display an estimated VAT cash/working-capital schedule, calculation details, source and effective dates, and 'planning estimate — review with tax adviser'. Unknown applicability or eligibility remains `NEEDS_REVIEW`, not 0%. The user can manually override assumptions with reason/audit.
- UK/US/GCC rules or rates must not be copied into UAE settings. Do not treat the standard rate as applying to every transaction or automatically decide VAT registration.
- Test examples: taxable AED 1,000 exclusive at user-entered 5% → AED 50 output estimate; if stated to be inclusive, taxable base 1,000/1.05 with rounding policy (example AED 952.38 base, AED 47.62 VAT for half-even 2-decimal rounding). An exempt or uncertain transaction is flagged, not silently taxed at 5%.

### U-03: corporate tax planning, not filing
- Store user-entered accounting profit, explicit adjustments, taxable-income assumption, standard/free-zone status as supplied, projected tax expense and cash timing, source and version. V1 must permit a direct manual tax provision without asserting tax liability.
- A limited opt-in **illustrative** standard-rate scenario may calculate `max(0, taxable_income − 375,000) × 0.09` only after user explicitly confirms the regime and that special elections/reliefs/grouping/exemptions do not apply. 0%/9% thresholds apply to taxable income, not automatically accounting profit, turnover or VAT base. Historical tax periods, qualifying free-zone treatment, Small Business Relief, loss/interest restrictions, international tax and Pillar Two require separate rules and expert review. Do not guess qualifying status or imply this illustration is a return.
- Formula example only, for a single standard-regime person with no adjustments: user-supplied taxable income AED 500,000 → illustrative tax AED 11,250. Free zone/QFZP status unknown or selected → **do not** apply that standard threshold automatically.
- Audit source, rule pack revision, policy reviewer, effective dates and overrides. Offline users need a manually imported, signed policy update or must confirm reviewed assumptions as of their chosen date; warn when guidance may be outdated. Statutory validity/review is outside product guarantee.

## U-04: native Excel V1 — outcome contract
### Required supported flow
1. Offline install local app and native add-in on the user's Windows machine with **compatible licensed desktop Excel already installed**. Target Office 2021 64-bit; confirm exact edition/build and add-in policy in the pilot; 32-bit is not assumed. Load/unload without changing global Office security settings.
2. From Excel open/create a user-selected project through the authorized local core, not by opening SQLCipher/DuckDB files from the XLL. User unlocks project; Excel can connect to an existing core or launch/start one after explicit local authorization. The core is sole writer. Define and test what happens when desktop UI is closed while Excel remains open; keep core under a documented lifecycle lease or explicitly disconnect safely—never lose a commit.
3. `FPA.GET` (provisional API name) reads a fully specified coordinate from a known project/scenario/period/revision. Missing/unavailable/unauthorized data maps to explicit Excel error/status and diagnostic; never return cached number as current silently. Workbook calculation mode and refresh state must be visible.
4. User explicitly selects a range, opens a **command** (candidate XLL command/menu; UI implementation must be demonstrated), reviews mapping/old/new/validation and expected base revision, and confirms one atomic batch. Core enforces authorization, revision, source provenance and audit. Any row error or revision conflict rejects all rows; retry of same request ID is idempotent. Excel formulas/UDF recalculation never write to the project.
5. User runs explicit refresh after a core/model change. Document/test whether refresh recalculates only affected functions or workbook, in automatic and manual mode. Record displayed revision; prevent an old calculation response replacing a newer revision. On crash/reopen/reconnect, unfinished requests have a visible status and cannot be mistaken for committed.
6. Excel unavailable/blocked: core still usable, but V1 release gate fails if supported Excel add-in is not functioning. Optional richer ribbon or task pane is **not** included in minimum acceptance.

### Candidate implementation and blockers
Preferred feasibility candidate: Rust native `.xll` implementing the Windows Excel C API ABI, independently tested with Excel SDK/header ABI and actual supported Excel build. Microsoft XLL documentation describes C/C++; that alone is not proof of a Rust implementation or warranty. Verify calling convention, exported symbols, structure layouts, memory lifetime/free callbacks, 32/64-bit compatibility, licensing/SDK distribution and safe unload. Use narrowly reviewed `unsafe` FFI, panic containment and no exceptions crossing ABI. XLL runs inside `EXCEL.EXE`; never terminate Excel when supervising a sidecar. The native core outlives/reconnects per explicit lease; no raw shared-memory pointer handoff. Register thread-safe only after reentrancy and Excel API restrictions are proven. Microsoft states worksheet functions cannot call command-equivalent `xlSet`; don't implement side-effecting `FPA.SET()` UDF. XLL native command UI or a separately approved COM/.NET shim is a contingency if UX requires it. Alternative Office.js alone is **not** automatically equivalent to the user's native requirement; ask before substitution.

### Precision and type boundary
Excel numerics use binary floating point; the authoritative engine uses decimal. `FPA.GET` numeric output must state conversion/rounding policy and cannot promise that arbitrary high-precision decimals are preserved. If precision/range would be lost beyond defined scale/tolerance, return explicit error or offer text/exact-value output; test large values, decimals, negatives and currency rounding. On write-back, inspect cell value/type, reject Excel errors, ambiguous text, non-finite values, dates masquerading as numbers and unsupported precision; user may choose an explicitly documented text/decimal path. Compare round-trip at currency scale against engine, not raw binary bit pattern. Provide user-facing guidance for Excel numeric limits.

### Workbook compatibility and safety
V1 supports add-in-linked workbooks and app-created reports; it does **not** promise arbitrary workbook import, formula equivalence or lossless template modification. No overwrite of existing workbook; save an explicit new copy. Never run macros or execute formulas from imported documents in the application. Preservation of an unmodified ZIP/XML part doesn't establish workbook semantic fidelity: relationships, signatures, calculation chains, formulas and caches may change. For each supported operation publish precise tested XLSX/XLSM capabilities; unknown or signed/encrypted documents require warning/refusal. Test source-file hash unchanged.

### Excel tests — all mandatory for release
- Real target Windows + real target Excel, no internet, install/load/unload and restart from clean profile with app initially not running; document trust prompts/policy.
- Golden `FPA.GET` returns AED 1,000.00 at specified revision; change input in app → Excel stays old/visibly stale until refresh → refreshed value matches new revision; test workbook manual and automatic calculation modes.
- Select two valid inputs → preview → confirm → exactly one commit and one batch audit; reopen app → both persisted. One bad row → no changes; same retry ID → no duplicate; stale expected revision → conflict.
- Excel double conversion tests with 0.1, rounding ties, large/high precision, negative amounts and text path; unknown coordinate/error/locked project yields a visible error, not zero.
- Two Excel workbooks/processes: exactly one authorized project owner, no silent overwrites; test concurrent requests/cancel, Excel crash mid-request, core restart and idempotent retry; verify commit outcome by request ID.
- Add-in disabled/untrusted/Excel absent → clear failure; desktop core remains usable. Uninstall preserves workspaces and does not broadly remove unrelated trust settings. Test automatic calculation does not write and does not run untrusted macros.
- Performance: measure actual p50/p95 for 100, 1,000 and 10,000 GETs and one batch write on named Office/device; no pre-claimed 40 ms. Full test evidence includes Excel version, bitness, OS build, setup and logs with no finance values.

## Source notes (re-verify before implementing legal content)
- UAE FTA corporate tax rates: https://tax.gov.ae/en/taxes/corporate.tax/corporate.tax.topics/tax.rates.aspx
- FTA guide on different qualifying free-zone-person treatment: https://tax.gov.ae/Datafolder/Files/Guides/CT/Free%20Zone%20Persons%20-%2020%2005%202024%20final%20for%20GCD.pdf
- UAE Ministry of Finance corporate-tax accounting standards decision, subject to later changes: https://mof.gov.ae/wp-content/uploads/2023/05/Ministerial-Decision-No.-114-of-2023-on-the-Accounting-Standards-and-Methods-for-Corporate-Tax-Purposes.pdf
- FTA VAT registration rules and non-resident distinctions: https://tax.gov.ae/en/services/vat.registration.aspx
- Excel XLL multithreading and worksheet command restrictions: https://learn.microsoft.com/en-us/office/client-developer/excel/multithreaded-recalculation-in-excel
- XLL load/security behavior: https://support.microsoft.com/en-us/excel/excel-is-blocking-untrusted-xll-add-ins-by-default
- Excel recalculation: https://learn.microsoft.com/en-us/office/client-developer/excel/excel-recalculation
