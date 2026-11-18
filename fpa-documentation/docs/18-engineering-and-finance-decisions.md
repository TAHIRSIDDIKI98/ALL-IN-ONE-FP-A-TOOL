# 18 — Engineering, finance and lifecycle decisions still required

> **Correction:** [ADR-001](../decisions/ADR-001-v1-lean-local-core.md) is an external AI recommendation, not an approved architecture. All conflicting design choices remain open.

**Status:** Draft; proposals below are not implemented. Resolve the relevant decisions before the corresponding task is approved. Technical sketches are not proof that any library/API works as described.

## 1. Exact state and data ownership
- Define what is authoritative for **every** value: original source files, imported facts, mappings, overrides, formulas, scenario deltas, audit, calculation result and DuckDB projection. Map each to a storage file, encryption, lifecycle, writer and retention class. Keep authoritative state in one commit domain; projections can be rebuilt and their generation exposed.
- Introduce **model revision** and **calculation generation** as separate identities. A report must state if all displayed cells belong to the same complete generation; no mixing old and new results under a 'current' label. Recalc may be cancelled but cannot expose partially calculated results as complete.
- Define what happens to existing reports when mapping/hierarchy changes, accounting periods are closed, actuals are restated or a source row is corrected. A revisioned restatement retains prior approved reports; permitted lock override requires reason, audit and finance policy. An audit record is not independently tamper-proof.
- Full storage failure matrix: checkpoint failure, directory replacement, locked files, disk full, stale lease, concurrent Excel session, process killed after commit before reply, corrupt SQLite/manifest/artifact/projection, backup interruption and power-loss proxy. State outcomes: `rejected`, `committed`, or `unknown until query`; idempotent status resolution using persisted operation key. An acknowledged authoritative transaction must either recover or stop with explicit corruption/recovery instructions; never fabricate data.
- Specify `RPO` (maximum tolerated acknowledged data loss) and `RTO` (maximum acceptable restore time); do not claim 0 until tested against actual storage/power-loss behavior. Supported filesystem, removable drives, network shares, VM snapshots, encryption and OS paging need explicit matrix.

## 2. Financial policies, scope and invariant applicability
- **Data grain:** transaction vs balance vs P&L/summary, account/time/entity mappings, duplicate rules, fiscal calendar/time zones and cutoff, actual/budget snapshots and grain-dependent lineage.
- **Dimensions:** effective dates, alternate rollups, non-additive measures, numerator/denominator hierarchy, unit conversion and chart changes. Group reports cannot add different currencies or incompatible account classifications. Holdings/dividends are not automatically controlled company revenue.
- **Numeric policy:** decimal representation, range, intermediate precision, rounding modes, per-currency/measure scale and negative rounding, overflow, allocation penny and tie-breaking rules. Financial rates use decimal unless approved; Excel binary floating conversion needs separate error/precision policy. Publish formulas and version.
- **Close and statements:** opening balance source, equity roll-forward, finance-approved cash-flow mapping, accounting adjustments, checks and report labeling. Draft can be unbalanced; approval must block if controls fail. State and test exact tolerances; don't assume every edit preserves a valid balance sheet.
- **Mandatory group consolidation:** approved control/ownership changes and effective dates; standalone vs subgroup; intercompany matching/differences; consolidation journals and reversals; historical/spot/average rates and CTA; equity accounting, NCI, investment basis, fiscal alignment and acquisition/disposal. Templates are not a substitute for accounting policy. Capture source of FX, rate type, dates, triangulation, closing versus average and missing-rate policy.
- **UAE:** approved fiscal periods, Arabic/English and conventions, CT/VAT assumptions per entity and date, free-zone eligibility and treatments. Workforce expansion should separately cover UAE end-of-service, pension vs gratuity, applicable categories, alternative savings scheme and timing with qualified HR/payroll/legal review; do not copy US FICA or automate legal decisions without a separate spec.

## 3. Excel-native behavior: unresolved questions
1. **Binding:** one workbook may reference which workspace, entity, scenario and revision? Identify stable workspace IDs, not paths. Define copies/renames and moving to a new device; never silently point to a different client workspace.
2. **Lifecycle:** identify core lifetime when Excel starts first, desktop UI exits, multiple Excel instances or projects are open, Windows logoff or add-in is unloaded. Avoid one host closing another host's project or killing Excel. Define lock ownership and reattach/recovery.
3. **Refresh and saved files:** cached values in Excel can persist even when an add-in is absent, blocked, disabled or project is locked. A function cannot guarantee it always replaces stale values before someone views a workbook. Design a visible revision/status cell and documented clear/manual-refresh procedure, error when actively evaluated offline, export labels and user training; test workbook open with add-in disabled. Residual risk remains for already saved/copied values, so don't promise zero stale displays.
4. **Decimal boundary:** choose explicit numeric conversion and supported significant digits/scale. Text gives exact display but does not behave like numeric Excel. Detect and fail unsafe imports/exports; test 0.1, rounding ties, large numbers, negative, blank, errors and locale. Do not claim arbitrary Excel numeric equality with decimal backend.
5. **Write command:** select range and map coordinates; show value/old/new/base revision/errors, confirm once, atomic core transaction, audit and refresh. Persist idempotency key and status across core/Excel crash. UDFs have no financial side effects; Excel undo must not imply committed core write has been reverted. Provide a separate audited reversal/undo command and define conflict behavior.
6. **Formats/security:** specify XLSX/XLSM / external links / formula caches / protected/encrypted/signed files as supported, refused or warned. Never promise preservation merely from XML part hashes. Do not run macros or silently relax Trust Center, install broad trusted locations, alter Excel calculation mode or create firewall exceptions. Document 64-bit supported edition/build and IT approval.
7. **Office temporary data:** even with encrypted workspace, Excel's own workbook cache, autosave/autorecover, clipboard, printing, pagefile and exported workbook may be unencrypted. Restrict through approved Office/OS/device configuration; notify the user and treat copies as separate sensitive assets. Software cannot retroactively revoke a shared workbook.

## 4. IPC and security design
Framed stdio is a proposed child-process path, not an Excel connection or an instruction to log payloads. Define one framing version, endianness, lengths/quotas, protobuf field evolution and unknown fields, protocol handshake, startup deadline, stderr redaction, cancellation, queue caps, shutdown, crash/backoff and version compatibility tests. Choose verified named pipes for separately launched Excel or an approved alternative. Explicitly threat-model same-user malware, admin, executable replacement and PID reuse; do not claim ACL/PID identity alone is strong isolation. Prohibit network binding by default; allowlist any local transport and user-enabled connector. Child processes must not obtain project encryption keys unnecessarily.

## 5. Test automation and evidence in an offline enterprise
- Build/test tools may be acquired on a connected development machine; offline **runtime** is mandatory. For offline builds, procure an approved local artifact mirror/cache with pinned hashes and licenses. No assumption that GitHub Actions or third-party cloud is allowed for customer data. Local Windows scripts and a disposable VM can run CI-style gates.
- Separate mandatory per-change tests from expensive scheduled tests. A performance regression threshold is meaningful only on controlled, representative hardware; note warm/cold, input, repeat, system contention, p50/p95 and failures.
- Spec test matrix must cover requirement→test→run→evidence→approval, differentiating unit/integration/Excel E2E/security/SME. For each failure retain seed, source version and redacted evidence. Prevent an agent editing both spec and oracle without approval. Independent finance fixtures do not require exposing real data to an AI.
- A minimum finance review for every shipped sector: one manual case, one negative/edge case, one real-world-like reconciliation, signed assumptions and known unsupported cases. A lightweight generic sector template cannot inherit a claim of accurate comprehensive operational modeling.

## 6. Document package to create when information arrives
| Document | Required content | Owner |
|---|---|---|
| Signed pilot charter | business roster, UAT, approved access and evidence | product/senior |
| Business glossary & KPI dictionary | grain, formulas, units, entity, source, display, approval | finance/sector SME |
| Entity/ownership/currency map | legal entities and effective-dated relationships, sources | group finance |
| Finance policy & worked examples | accounting conventions, exact numerical cases, exclusions | finance SME |
| Sector PRD per business | must-have workflow, dependencies, input/output, tests and limitations | sector/product owner |
| Excel contract & compatibility matrix | functions/commands, lifecycle, refresh/cache, precision, test edition | Windows/Excel lead |
| Data dictionary + import mapping catalogue | schemas, encodings, dates, units, reconciliation, source granularity | data owner |
| Threat model + data-flow | stores, IPC, Excel/Office caches, clipboard, logs/AI tooling | security/IT |
| Backup, restore, update & incident runbooks | keys, RPO/RTO, owner, step-by-step evidence | IT/release |
| Test strategy + evidence index | manual goldens, differential, offline, crash, Excel and UAT | QA + SME |
| Privacy/legal and license register | applicable requirements, rights, source/date, review and expiry | counsel/release |
| Human approvals/change log | decision, version, approver, effective date and outstanding risks | owner |

## 7. Optional roadmap items often forgotten
Cash 13-week and longer-horizon linkage; cost allocation; workforce and UAE end-of-service provisions; IFRS 16 leases; investment carrying values/valuation and distributions; property rent collection/lease expiry; inventory costing; CapEx/impairment; industrial scrap/energy/freight; scenario and reporting versions; baseline forecasting and evaluation; finance commentary/notes; exception management, data lineage, standard vs actual. These are **candidate** features, not automatic V1 scope or accounting guarantees. Each needs an independent owner, acceptance cases and priority decision.
