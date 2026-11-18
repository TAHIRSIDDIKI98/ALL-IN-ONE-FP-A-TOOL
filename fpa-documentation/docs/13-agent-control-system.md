# 13 — Solo AI-agent control system and test matrix

**Status:** Draft. This document is a practical execution mechanism, not a claim that agent drift, fraud or accounting errors become impossible. One human owner remains accountable; independent human finance/security expertise is a release condition, not something more tokens replace.

## The fixed development loop
1. **Owner selects exactly one approved task.** Start from clean Git state, capture commit ID, read `AGENTS.md`, `STATUS.md`, task, linked requirement/spec/ADR and relevant source dates.
2. **Specification session** writes concrete positive/negative expectations with independent numeric fixture; if policy is unclear it writes a question, not a guess. Human reviews. Use a separate context for test author vs implementer when practical. Neither role is independent merely because a different model wrote it.
3. **Implementer session** receives only the task and context pack; writes the smallest solution. It may suggest test changes but cannot weaken acceptance tests without explicit owner approval and preserved rationale. Security/Windows FFI, crypto, storage and financial semantics require specialist review; absence is a blocker, not permission to skip.
4. **Reviewer session** gets requirements, tests and diff, attempts to falsify assumptions, catches test-implementation shared errors, and reports severity + evidence. Human triages and requests fixes.
5. Run the exact documented commands; retain failing and passing outputs, Windows/Excel/CPU/version and fixture IDs. Label test-skips honestly. No live customer data or secrets in prompts/logs.
6. Update requirements registry, ADR if needed, doc spec, changelog and `STATUS.md` in the same change; record actual results and open limitations. Commit after review; tag releases after all gates and approvals.

**Not allowed:** deploy a 42-prompt sequence autonomously, auto-approve changes, infer APIs from another model's fabricated code, replace real Windows/Excel tests with mocks, or assert certifications or benchmark results.

## Suggested live docs to create after scope approval
```text
requirements/registry.csv    # IDs, scope, owner, test IDs, evidence, status
spec/finance/                # one feature + examples + policy owner each
spec/excel/                  # ABI, UX, precision, refresh, error contract
spec/contracts/              # versioned IPC and data records
spec/security/               # threat model, key lifecycle and recovery
spec/uae/                    # sourced time-bounded policy assumptions, review record
adr/                         # one decision per file with alternatives/evidence
fixtures/synthetic/          # source records + expected outputs + source/method
quality/test-matrix.csv      # requirement → case → environment → evidence
quality/runbook-windows.md   # repeatable commands and prerequisites
STATUS.md / CHANGELOG.md / AGENTS.md
```
Documentation task definition: every artifact has status, owner, scope, inputs/outputs, error behavior, acceptance cases, sources/last verified and change history. Do not label a draft as approved.

## Reference model strategy
Build a simple **independent** correctness oracle first for the *selected* arithmetic and aggregation subset: stable coordinates, decimal amounts, direct AST interpretation, naive graph evaluation, no optimization/parallelism. It is not production fallback and does not implement speculative features. For formula behavior the independently reviewed spec supplies expected semantics; write small manual goldens outside both engines. Compare reference vs production on randomized valid models, mutations, null/errors and first-period rules; minimize failing seeds and retain regressions. Add an independent SQL/Excel/finance check only where semantics actually match (Excel is not the oracle for UAE tax/accounting policy). An interpreter with the same wrong spec as the fast engine can pass while both are wrong.

## Initial test matrix (tests described, none executed)
| Test ID | Requirement | Input/action | Expected observation |
|---|---|---|---|
| T-OFF-01 | PRD-001 | clean Win11 x64; physical network off before installation; WebView2 absent | setup installs bundled prerequisite, launches without account/network; monitored journey completes |
| T-OFF-02 | PRD-001 | after install, restart and offline upgrade | opens existing project, verifies signed package, retains recoverable pre-upgrade snapshot |
| T-IMP-01 | PRD-003 | balanced AED source records with explicit map | one committed batch, expected input count/totals equal imported totals and source hashes |
| T-IMP-02 | PRD-003 | malformed value/unknown account/unbalanced journal | clear row or batch validation; zero committed rows in strict mode |
| T-IMP-03 | PRD-003 | retry same batch ID and payload then change payload | original result/no duplicate; changed payload gives explicit conflict |
| T-CRASH-01 | PRD-008 | terminate at each artifact/manifest/projection transition | no uncommitted visibility; committed state recovered or explicitly blocked if corrupted |
| T-FIN-01 | PRD-004/005 | journal fixture in `03-finance-engine.md` | P&L income 400, ending cash 400, assets/equity 500, indirect cash movement 300 |
| T-FIN-02 | PRD-005 | remove credit source leg | imbalance displayed; no approved export and no auto-plug |
| T-NUM-01 | FIN-001/002 | rounding ties, 0.1+0.2, divide-by-zero, absent vs zero | approved decimal output, explicit error, distinct missing state |
| T-CALC-01 | PRD-004 | random DAG and one edit | incremental = full = reference for supported exact semantics; failing seed retained |
| T-UAE-01 | PRD-012 | user-approved AED 1,000 VAT-exclusive at explicit 5% | estimate AED 50, classification and rate source visible; not a filing outcome |
| T-UAE-02 | PRD-012 | QFZP status unknown | no automatic standard threshold claim; `NEEDS_REVIEW` |
| T-XLL-01 | PRD-011 | network off, install/load XLL, core initially closed | user authorizes project; GET returns correct coordinate/revision; exact Excel build recorded |
| T-XLL-02 | PRD-011 | Excel two-row confirmed push, retry ID | one transaction + audit, two correct values; retry no duplicate |
| T-XLL-03 | PRD-011 | invalid cell or stale revision during push | entire push rejected, report row/conflict; original revision preserved |
| T-XLL-04 | PRD-011 | app change then Excel manual/automatic refresh | stale/current status and revision accurate; refresh produces correct numbers |
| T-XLL-05 | PRD-011 | large/high-precision Excel numerics and text path | no silent precision loss; explicit error or reviewed conversion |
| T-XLL-06 | PRD-011 | crash Excel/core around commit, reopen | request ID resolves committed/not committed/unknown safely; no duplicate side effects |
| T-SEC-01 | PRD-008 | copy encrypted project to new Windows user and open | no unauthorized plaintext; recover using intentionally established recovery method |
| T-SEC-02 | PRD-008 | corrupt log and compare to independent checkpoint | mismatch detected; without checkpoint don't assert prior completeness |
| T-REST-01 | PRD-008 | restore encrypted export to second Windows profile/device | all committed inputs and expected report reproduced; key recovery verified |

## Phase 0: exact gating order for this user
- **P0-A Documentation and pilot:** confirm vertical, one sample input/workbook with sanitized synthetic counterpart, exact Excel build/bitness and whether employer policy blocks native add-ins. Agree the scope of a numeric read and explicit range-push. Identify an independent UAE accountant and security reviewer before finance/security release; if unavailable, mark pilot experimental, not production-ready.
- **P0-B Excel feasibility:** prototype read UDF, explicit push command, project owner lifecycle, offline install and recovery on that real Excel. Record how candidate Rust ABI is implemented and any non-Rust glue. Failure → present alternative to user; do not silently cut native Excel.
- **P0-C Data/security feasibility:** demonstrate local encrypted project, authenticated pipe for independently launched Excel, user-mediated key recovery across profiles, single-owner lock, artifact/manifest fault injection. Limitations are evidence, not successful product tests.
- **P0-D Tech selection:** small representative grid/stdio Go/Java/Elixir spikes; test only intended sidecars; pick licensed dependencies and Windows packaging; record ADRs and budgets from measurements.
- **P0-E Walking skeleton:** install offline → open sample project → import approved AED fixture → show P&L → `FPA.GET` from Excel → preview+commit one value → refresh → backup/restore. No industry or tax compliance claims.

## Solo schedule, cost and go/no-go
Do not inherit another model's 4–6 or 12–15 month claims as forecasts. First record hours/week, engineering experience, paid licensing and SME availability. Spend 2–4 weeks *if full-time-equivalent* on documentation and feasibility, then estimate remaining work from measured task throughput and Excel/security findings; elapsed calendar time is different from effort. Maintain optimistic/base/pessimistic estimates with contingency and scope, reforecast at every gate. Time-to-release remains unknown. Paid expenses can include Microsoft Office and Windows licensing, signing certificate, test hardware/VM, accountant/security review and domain/commercial library rights; unlimited tokens cover none of these automatically.

## Next-session command for the user's coding agent
```text
Read README.md, AGENTS.md, STATUS.md and docs/01 through 18. Scope confirmed:
UAE, single user, native 64-bit offline Excel add-in required in V1, solo AI builder,
both Al Ghurair sites in business coverage, true consolidation required, and
Office 2021 64-bit. Legal entities/accounting perimeter must be verified.
Read ../_project_brain/00_GOLDEN_RULES.md and 04_ACTIVE_STATE_AND_TASKS.md.
Do not write product code yet. Identify unresolved choices for DOC-001,
produce a requirement-to-acceptance-test registry using only confirmed facts,
and propose one tiny Excel feasibility spike. Do not claim tests were run,
do not infer Office edition or UAE tax eligibility, and do not mark decisions
approved without the owner's sign-off. Cite doc paths and list any conflicts.
```
