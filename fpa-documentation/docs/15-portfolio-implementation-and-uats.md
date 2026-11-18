# 15 — Portfolio implementation, data contracts and UAT

**Status:** Draft v0.3; all client names/structures provisional, source data synthetic. Project remains in documentation phase. Confirm the legal reporting perimeter and senior's detailed needs before coding; the user includes both sites. One user ≠ one business or one entity.

## Explicit scope change v0.2 → v0.3
User requests coverage of all businesses of the senior's group. Supersede any older 'one legal entity only' V1 planning assumption with a **multi-entity/multi-business single-user pilot**. Each entity has separate mappings, source batch, period, scenario and currency; no new multi-user or network sync. True consolidation is a user-confirmed V1 requirement, but no statutory/IFRS claim is justified until finance validation. Office 2021 64-bit is confirmed; exact build and add-in policy are not. Both websites are included in coverage per user. Read docs 14 and 19 for scope and evidence.

## Common model: suggested metadata
```text
Workspace(workspace_id, owner, encryption/recovery version)
LegalEntity(entity_id, display_name, jurisdiction, currency, fiscal_calendar,
            valid_from, valid_to, policy_id)
BusinessUnit(unit_id, entity_id, sector_id, valid_from, valid_to)
HierarchyVersion(hierarchy_id, parent, child, effective_from, effective_to,
                 classification, source, approval)
Scenario(scenario_id, base_revision, name)     # actuals immutable once locked
Period(period_id, calendar, starts_on, ends_before)
Account(account_id, display_sign, report_role, aggregation_method, unit)
Measure(measure_id, decimal_scale, unit, currency, type, aggregation_method)
Fact(entity_id, unit_id, measure_id, period_id, scenario_id, value, source_revision)
InputBatch(batch_id, request_hash, entity_id, mapping_version, source_hash, status)
DataLineage(fact_id, row_ref, file_hash, transform, revision)
```
None of this implies that a public brand is a legal entity, controlled subsidiary, reporting segment or tax group. Admin enters approved data with effective dates; rules that exceed the approved model must flag `NEEDS_REVIEW`. Base and reported/constant currency are not automatically fungible. Missing vs zero vs invalid is explicit.

## Input contracts (examples; schema finalized by pilot)
- **Actuals/TB:** `source_system,batch_id,journal_id,line_id,posting_date,period,entity,unit,account,debit,credit,currency`; policy may support signed amounts instead of separate debit/credit. Require mapping, duplicate and balance controls. A summary TB without transaction-level data cannot support journal-level lineage; show source granularity honestly.
- **Monthly operating drivers:** `entity,unit,period,scenario,metric,quantity,unit_of_measure,price,currency,source`; valid combinations depend on approved template. Revenue from volume × price only if units and period align.
- **Property:** `entity,property_id,period,scenario,leasable_area,area_unit,leased_area,contract_rent,operating_cost,currency`; no tenant PII needed for generic template. Vacancy and occupancy require positive denominator and date scope.
- **Investment:** `entity,asset_id,period,scenario,ownership_pct,opening_carrying_value,dividends,closing_carrying_value,currency,valuation_source`; don't calculate unapproved gains, consolidation or return ratios from insufficient data.
- All imports use explicit encoding/locale, IDs, mapping version, preview, duplicate handling, revision guard and strict reconciliation. Exact template versions and expected totals go into test registry. Never silently quarantine/dismiss missing records.

## KPI contracts: examples, not accounting policy
Each KPI has scope/grain, numerator, denominator, dimensions, time, currency/unit, aggregation, owner, formula, display/rounding, lineage and error behavior. For example, property occupancy = `leased_area / leasable_area`; use same property, period and area unit; denominator zero → typed error; portfolio occupancy = sum leased area / sum leasable area for compatible assets, not the average of displayed percentages. Where occupancy definitions vary (e.g. economic vs physical), show separate metrics and seek owner approval.

Industrial operating margin KPI requires financial account map and selected time/window; formula does not itself prove gross margin or EBITDA. Volume must use a declared kg/tonne/unit conversion. An investment's dividend or fair-value movement is not automatically equivalent to revenue/EBITDA.

## First pilot vertical slice
1. On clean Win11 and target 64-bit desktop Excel, install offline.
2. Create encrypted workspace; load the synthetic three-business fixture defined in document 14. Each import has source, mapping, batch, entity, scenario and revision.
3. Create one side-by-side report showing AED revenue, mapped EBITDA, period/units, source status, individual source reconciliation and non-consolidation warning; keep dividends separate.
4. Open native Excel; use an explicit read-only GET at same revision, review/push one planning input through a command, refresh, then reconcile app/Excel. No workbook UDF writes, no arbitrary workbook modification claim.
5. Test invalid imports, missing business, rejected write, stale revision, interrupted transaction, secure backup/restore and offline restart. Obtain senior feedback using synthetic data, then decide whether to add a representative company-approved sample.

## Additional UATs (all planned, not passed)
| ID | Input/action | Expected |
|---|---|---|
| T-AG-01 | Synthetic three-business fixture | revenue 3,100; expense 2,250; EBITDA 850; dividend 100 shown separately; report labeled unadjusted/not consolidated |
| T-AG-02 | Metals file absent | explicit missing status and no unlabeled complete total; no silent zero |
| T-AG-03 | One entity in USD, others AED | side-by-side by currency; no combined AED figure without reviewed, versioned rates/policy |
| T-AG-04 | IC transactions unknown | flag total as unadjusted, do not claim consolidation or remove activity |
| T-AG-05 | Ownership 20% and listed investment | manual holding data shown; no assumption of control or consolidation |
| T-AG-06 | Both public sites in user-defined business coverage | both portfolios appear; legal entities/control/consolidation perimeter are sourced from approved group finance records, not inferred from website names |
| T-AG-07 | Property A leased 80/100 sq ft; B leased 30/100 sq ft | combined physical occupancy 55%; no average-of-displayed-ratios mistakes where area differs (add unequal-area fixture) |
| T-AG-08 | Packaging volume 2 tonnes × 500 AED/tonne | revenue driver 1,000 AED; incompatible kg/tonne conversion explicitly resolves or errors |
| T-AG-09 | Native 64-bit Excel, core initially stopped, offline | controlled connection and project unlock; revision-tagged GET; app/Excel status clear |
| T-AG-10 | Bulk write 2 values, one invalid | no partial write; row-level error, prior revision remains |
| T-AG-11 | Export report containing missing entity | visibly incomplete and no approval/consolidation claim |
| T-AG-12 | authorized confidential data to external agent | blocked by policy; use approved synthetic fixture instead |

For unequal-area occupancy: A 80/100, B 30/300 = 110/400 = 27.5%, **not** unweighted mean of 80% and 10% (45%). Test empty and zero-denominator cases.

## Roadmap revised for sector breadth
- **D0 — identify & discover:** website/legal entity confirmation, senior interview and approved synthetic fixture; record sectors and source versions.
- **D1 — contracts:** approve entity/unit hierarchy, consolidated reporting policies, both-portfolio inventory, KPI/report definitions, Office 2021 build, security/recovery, finance reviewers and privacy guardrails.
- **D2 — Excel risk spike:** real 64-bit Excel read, refresh and explicit write command with offline startup and safe crash/retry. Release blocked if native Excel cannot be delivered; no silent alternative.
- **D3 — cross-portfolio core:** encrypted workspace, entity/unit mapping, actuals, true consolidation as specified in doc 19, assumptions, per-sector templates and report, independent decimal reference evaluator and recovery testing. Include every confirmed business in the coverage matrix but never claim detailed specialty features prematurely.
- **D4 — pilot quality:** senior runs synthetic then explicitly approved anonymized test; independent finance/accounting and security reviews; offline installer, backup, provenance and acceptance evidence.
- **D5 — additional depth:** expand industry detail and consolidation cases beyond agreed V1 scope based on senior input. V1 already requires true consolidation; agree IC/FX/NCI policies and acceptance before building. Time unknown until spikes and hours/week are known.
