# 19 — Mandatory group consolidation: design and approval backlog

**Status:** Draft; not an approved accounting policy or implemented feature. User requires true consolidation and says both Al Ghurair websites are within the target group. This records user direction for **business-coverage planning**; it does not establish the legal parent, control, common reporting boundary, percentages, effective dates, tax group or current ownership. Obtain an authorized entity register and qualified finance approval before calculations or real-data pilot. All values below are synthetic.

## Scope and acceptance hierarchy
- **Product vision:** all-industry FP&A; target relevant industrial, packaging, metals, property, investments, foods, development, mobility, infrastructure and property-management use cases represented on the two public sites. Their precise business/entity list and required depth are pending senior review.
- **V1 must-have:** single-user offline Windows app, 64-bit native Office 2021 Excel integration and **true consolidation**, not an unadjusted sum. Required detail and policy must be agreed; do not silently defer consolidation or claim V1 complete if it is absent.
- **Do not overpromise:** a prototype may show clearly labeled partial or synthetic outputs while development continues; it is not V1 release completion, IFRS certification or an approved consolidated report.

## Consolidation capability specification to author with finance SME
| ID | Required definition / evidence | Status |
|---|---|---|
| CONS-001 | Entity register, legal ownership, effective dates, control assessment, group/subgroup scope, ownership vs NCI, inclusion/exclusion and policy approvals. A brand/business unit is not automatically a controlled entity. | Draft; inputs absent |
| CONS-002 | Source TB/journals, entity accounting policies, currency, chart mapping, period alignment, initial balances, source-level reconciliation and period locks. Summaries cannot provide journal-level provenance. | Draft; inputs absent |
| CONS-003 | Reviewed translation policy: functional vs presentation currency, transaction-date/appropriate approximations, closing/historical rates, rate direction/source/effective dates, CTA/OCI/NCI, missing-rate handling and edge cases. No universal average-rate assumption. | Draft; inputs absent |
| CONS-004 | Explicit, reviewable intercompany partner/account matching, tolerances, reconciliation of differences and permitted elimination journals. No silent suspense or plug. Confirm treatment of unrealized inventory profit, upstream/downstream sales, dividends, loans and non-reciprocal balances. | Draft; inputs absent |
| CONS-005 | Investment and equity elimination, acquisition date and cost, goodwill/bargain purchase where applicable, NCI, subsequent movements, acquisition/disposal and changes of ownership. Differentiate subsidiaries, associates, JVs and passive holdings; accounting method must be approved, not inferred. | Draft; inputs absent |
| CONS-006 | Consolidation journals, source/reason, balancing, approvals, audit/idempotency/revisions, reconciliation between entity, adjustments and group; pinned reporting snapshots. | Draft; inputs absent |
| CONS-007 | Consolidated balance sheet, income and cash flow, parent/NCI attribution where required, reports and Excel retrieval; financial statement format and materiality approved. | Draft; inputs absent |
| CONS-008 | Missing entity/FX/ownership/mapping or unmatched material IC shows blocking exception for approved release; draft output explicitly incomplete. | Draft; inputs absent |
| CONS-009 | Independent accountant-authored golden cases, fault/restore tests, multi-period recalculation, reconciliation and senior UAT. | Draft; no tests run |

IFRS references are research starting points, not automatic standards selection: IFRS 10 discusses control and non-controlling interests [S1]; IAS 21 addresses translation and when a period average may be an approximation [S2]. Applicable standard, version and exceptions must be confirmed by the group accountant.

## Synthetic golden example — opening acquisition plus intercompany loan
This is a **manual example requiring SME review**, not a test already passed or legal guidance. Period-end, AED, no later income, FX, goodwill or taxes. Parent controls 80% of subsidiary, acquisition cost AED 80, subsidiary identifiable net assets AED 100, no goodwill under the stated assumptions. NCI at acquisition AED 20. Intercompany parent loan to subsidiary AED 10; entries already in standalone balances.

| Standalone balance | Parent | Subsidiary |
|---|---:|---:|
| Cash | 10 | 110 |
| Intercompany receivable | 10 | 0 |
| Investment in subsidiary | 80 | 0 |
| **Assets** | **100** | **110** |
| Intercompany payable | 0 | 10 |
| Share capital / equity | 100 | 100 |
| **Liabilities + equity** | **100** | **110** |

Proposed consolidation adjustments under the stated assumptions:
1. Eliminate IC loan: debit IC payable 10, credit IC receivable 10.
2. Eliminate subsidiary capital and parent investment: debit subsidiary equity 100, credit investment 80 and credit NCI equity 20.
3. Expected consolidated balance: cash/assets AED 120; IC receivable/payable and investment eliminated; liabilities AED 0; parent equity AED 100; NCI AED 20; total equity AED 120.

Tests to author after SME approval: replace the parent intercompany loan amount with AED 11, offsetting its cash by AED 1 so its standalone trial balance still balances, while subsidiary payable stays 10 → report an unmatched AED 1 difference; do **not** claim a complete reconciled consolidation. Remove ownership/control evidence → block approved output. Repeat same journal command/request key → no duplicate. Recalculate after changes and restore snapshot → same approved results. Unbalanced source/journal → block approved output. Other consolidation cases, real cash-flow statement and FX require independent fixtures.

## Delivery sequencing — release requirement is not postponed
1. **Document first:** confirm exact company structure, legal entities, source data, relevant standards, group reporting deliverables and V1 exception policies with senior/finance owner.
2. **Design and acceptance:** approved ledger/event schema, audited consolidation journal contract and rate/control treatment; create independently reviewed fixtures covering scope, IC, currencies and NCI.
3. **Spike:** prove offline 64-bit Office 2021 XLL candidate, secure project ownership and recovery, data handling and runtime packaging; no production claims.
4. **Incremental implementation after approval:** local standalone reporting → tested consolidation slice → expand to approved entity/scenario/FX/IC cases → group report + Excel integration. Each stage is transparently incomplete until **all agreed mandatory V1** conditions pass.
5. **Release:** independent group accountant and security/IT sign-off, real approved dataset tests, offline Windows/Excel and restore evidence, user acceptance and signed package. Business areas are covered according to the approved depth matrix, not assumed solely from public web pages.

## Sources
[S1] IFRS Foundation, IFRS 10: https://www.ifrs.org/content/dam/ifrs/publications/html-standards/english/2025/issued/ifrs10.html  
[S2] IFRS Foundation, IAS 21: https://www.ifrs.org/content/dam/ifrs/publications/html-standards/english/2023/issued/ias21.html
