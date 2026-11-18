# S-03 — Three statements and multi-currency consolidation: test specification

> **Correction:** The stack, thresholds, pre-approvals and spike order below came from another AI as recommendations, not from the owner. This draft is unapproved research; no spike is authorized or has run. Conditional C/C++ use is not pre-approved.

**Status:** Draft / NOT RUN / NOT INDEPENDENTLY FINANCE-REVIEWED. A proposed sequence suggests execution after S-02; this is not owner authorization; authoring this specification now does not execute the spike. [ADR-001](../../decisions/ADR-001-v1-lean-local-core.md) is an unapproved recommendation, not scope authority.

## Gate and test rules
- Build an independent manually reconciled golden model for synthetic entities, three linked statements, multi-currency conversion, control, ownership, NCI, IC and audit/reversal. External AI proposed threshold: **100% tie-out at 0.0001 currency units**. Every reported required number must equal its independently approved expected value at specified scale/rounding; no tolerance wider than 0.0001, no hidden plugs and no item omitted to obtain a pass. Numeric representation/rounding policy change requires owner and finance approval.
- The worked example below is a first **draft**, not an independent oracle or confirmation of IFRS compliance. A qualified reviewer must check accounting principles, currency/rates, acquisition and presentation; do not claim test passed until the reviewed expected model is fixed independently before comparing implementation. If reviewer unavailable mark BLOCKED.
- The external AI suggested 4-decimal monetary storage and 8-decimal FX/ownership, not approved; apply checked exact arithmetic and explicit 8-decimal ownership **fraction**, not ambiguous percentage. All conversions, multiplication, intermediate precision and rounding modes require approved policy; here numbers are chosen to avoid rounding ambiguity.
- The external AI proposes source entity TB balances before authoritative acceptance, and auditable journal layers for IC, goodwill/fair value, CTA and NCI. Separate functional/presentation currencies, reporting period, opening balance, FX sources, policy and version. No company data.

## Fixture F1 — illustrative, simplified acquisition and foreign subsidiary
For review: historical foreign acquisition at beginning of period, parent P owns **0.80000000** of S; no goodwill, tax, intercompany, dividends, opening/closing ownership change or external funding during period. Parent reports AED; S functional currency USD. Parent investment cost AED 80.0000 corresponds to 80% of S's USD 100 capital at historical rate 1 USD = AED 1.00000000. Opening P cash AED 920.0000 and equity AED 1,000.0000. Assume owner equity class includes initial funding as stated; acquisition cash effects occurred before opening and are not in current-period cash flow.

S activity: opening USD cash 100, cash revenue USD 10, cash expense USD 6; closing USD cash 104, net income USD 4. Rates for this illustration: opening/historical 1.00000000 AED/USD; period average 1.10000000 AED/USD, **assumed representative of exact transaction dates** for this cash-only activity; closing 1.20000000 AED/USD. These rates and average assumption are synthetic accounting hypotheses, not universal IAS 21 rules. No exchangeability exception.

### Balanced standalone closing trial balances
Sign convention: debits positive, credits shown separately. Each entity is balanced in its functional currency before import.

| Account | P debit AED | P credit AED | S debit USD | S credit USD |
|---|---:|---:|---:|---:|
| Cash | 920.0000 | — | 104.0000 | — |
| Investment in S | 80.0000 | — | — | — |
| Expense | — | — | 6.0000 | — |
| Share capital / equity | — | 1,000.0000 | — | 100.0000 |
| Revenue | — | — | — | 10.0000 |
| **Totals** | **1,000.0000** | **1,000.0000** | **110.0000** | **110.0000** |

### Translation and consolidation calculations
All figures below AED, 4 decimal places. S closing cash 104 × 1.2 = **124.8000**; revenue 10 × 1.1 = **11.0000**; expense 6 × 1.1 = **6.6000**; profit **4.4000**; capital at historical = **100.0000**. Translation reserve (CTA) = 124.8000 − 100.0000 − 4.4000 = **20.4000**. Profit attributed to NCI = 20% × 4.4000 = **0.8800**, to parent **3.5200**. CTA attributed to NCI = 20% × 20.4000 = **4.0800**, to parent **16.3200**. NCI closing = 20.0000 historical capital + 0.8800 profit + 4.0800 CTA = **24.9600**.

Illustrative audit trail: translated S TB (AED): debit cash 124.8000 and expense 6.6000; credit capital 100.0000, revenue 11.0000, CTA 20.4000; totals **131.4000 / 131.4000**. Consolidation elimination: debit S capital 100.0000; credit P investment 80.0000 and initial NCI 20.0000. NCI allocation of current profit/CTA to presentation equity must not double-count amounts. Exact mechanics/ordering are subject to finance review; if separate journal layers are used they must each balance. No journal is posted to an external ERP.

### Golden statements — whole group / period
| Consolidated statement item | AED expected |
|---|---:|
| Revenue | 11.0000 |
| Expense | (6.6000) |
| **Profit** | **4.4000** |
| Profit attributable to owners of P / NCI | 3.5200 / 0.8800 |
| Other comprehensive income: FX translation | 20.4000 |
| CTA attributable to owners of P / NCI | 16.3200 / 4.0800 |
| **Closing cash and total assets** | **1,044.8000** |
| Liabilities | 0.0000 |
| Parent opening equity | 1,000.0000 |
| Parent current profit and CTA | 3.5200 + 16.3200 |
| NCI closing equity | 24.9600 |
| **Total equity / liabilities plus equity** | **1,044.8000 / 1,044.8000** |

Cash flow is based on cash revenue/expense and exact transaction rates as assumed: opening group cash P 920.0000 + S 100.0000 = **1,020.0000**; operating cash flow USD 4 × 1.10000000 = **4.4000**; exchange-rate effect on opening/closing cash = **20.4000**; closing cash **1,044.8000**. Reconcile 1,020.0000 + 4.4000 + 20.4000 = 1,044.8000. The FX effect is shown separately, not mislabeled as operating cash flow. This synthetic example does not prescribe a universal cash-flow classification.

## Minimum test matrix
| ID | Action/input | Required expected behavior |
|---|---|---|
| FIN-01 | Manually recalculate F1 standalone TBs, translated TB, elimination, NCI, P&L, BS and CF. | All balances/totals equal reviewed golden values at 0.0001; three statements reconcile; no audit layer modifies entity source. |
| FIN-02 | Unbalance source TB by AED 0.0001 or omit a necessary row. | Reject/quarantine authoritative import, identify difference/source, no revision or partial state commit. Do not round away imbalance. |
| FIN-03 | Remove control/ownership evidence, period, FX rate or entity TB. | Block complete approved consolidated output; distinguish missing from zero. |
| FIN-04 | Balanced IC loan: parent receivable AED 10.0000 offsets its cash −10.0000; subsidiary payable equivalent +10.0000 offsets subsidiary cash +10.0000 (use same-currency fixture or approved conversion). | Debit IC payable 10.0000 / credit IC receivable 10.0000, balanced; no IC loan left in group totals; group cash unaffected by funding transfer when both sides recorded. Separate manually reviewed golden fixture required. |
| FIN-05 | Keep each entity TB balanced while changing IC receivable to 11.0000 and payable remains 10.0000. | Report mismatch 1.0000; no invented plug or complete matched output. |
| FIN-06 | 100%, 80%, 0%, changes of ownership, acquisition/disposal and goodwill/fair value. | Only tested cases with separately reviewed golden journals may be claimed; unsupported cases explicitly blocked/flagged. 0% ownership is not automatically proof of no control; consult legal control policy. |
| FIN-07 | Values 0.0001, negative, rounding ties, FX 8 decimals, 4-decimal storage boundary, checked i64/i128 overflow and sum overflow. | No float use in authority, declared rounding/multiplication policy, overflow fails with no mutation. |
| FIN-08 | Same idempotency key same payload, changed payload, stale revision, reversed adjustment. | Exactly one committed outcome for first; conflict on altered payload; no duplicate audit; reversal separately keyed and traceable. |
| FIN-09 | Recompute same approved revision after restart; compare audit and component lineage. | Identical full results, revision, source-digest and journal provenance; no mixed generations; tested with no network. |
| FIN-10 | Drive snapshot, restore or delayed response in S-04 scope. | No S-03 pass falsely implying S-04 ran. Correct post-crash behavior proved separately. |
| FIN-11 | Cross-currency IC, unrealized profit, tax, complex acquisitions and period mismatches. | Explicitly listed as required if in V1 acceptance; separately reviewed golden examples and policy before release. Block or clearly mark unsupported if policy/fixture missing; do not claim complete IFRS compliance. |

**Case coverage is not full IFRS compliance.** The user has mandated true consolidation; detailed applicability, supported cases and release acceptance must be approved by the finance owner. Tests FIN-04/06/11 still need independently derived golden outputs; until supplied they are **blocked/not run**, not passed. The proposed S-03 sequencing is unapproved; any future run requires owner approval and cannot pass if a required case lacks a reviewed oracle.

## Evidence record
Tester, source code revision and build, Rust and storage exact versions, test platform, policy version/approval, independently reviewed oracle version, inputs/source hashes, rate and ownership details, expected/actual outputs at 4 decimals, reconciliation, audit/event IDs, exact commands, failure/overflow evidence, date, deviations and reviewer sign-off. No app/test implementation currently exists.

References: [IFRS 10 issued text 2025](https://www.ifrs.org/content/dam/ifrs/publications/html-standards/english/2025/issued/ifrs10.html), [IAS 21 issued text 2023](https://www.ifrs.org/content/dam/ifrs/publications/html-standards/english/2023/issued/ias21.html); verify applicable current editions, rights and policies with qualified finance review.
