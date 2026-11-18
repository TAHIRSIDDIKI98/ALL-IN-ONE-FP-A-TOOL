# 14 — Al Ghurair Group pilot: portfolio and FP&A design

**Status:** Draft v0.5 · **Research date:** 18 November 2026 · **User-confirmed:** UAE, single user, Office 2021 64-bit, true group consolidation required, senior tester, and both public websites belong in target group coverage. **Not confirmed:** legal parent/entities, control, accounting perimeter, actual role/data access, exact Office build, FX/ERP, permission for company data. This is a proposed pilot, not a commissioned company project.

## Confirmed product-coverage direction and legal reporting boundary
The user states that **both websites belong to the target group** and requires coverage of both portfolios. Record this as user-provided context; the public pages describe different business areas [S1–S5]. Include both in discovery and product planning. This does not independently establish any particular common legal parent, ownership/control, tax group, or consolidation perimeter. Obtain the authorized entity/control register from the senior and group finance; public pages can be incomplete or stale. Do not fabricate company data, legal relationships, financial performance, internal systems or authorization.

## Public portfolio A — `alghurair.com` (user-included scope)
The group site lists three main verticals and separately publishes the following business descriptions. Named examples are public site descriptions only, not proof of present ownership percentages or consolidation treatment.

| Scope ID | Public business area | Public examples/activity | Planning capability to cover | Sources |
|---|---|---|---|---|
| AG-A1 | Packaging — film | Taghleef Industries; film manufacturing | demand by grade/product, kg/tonne, output/yield/scrap, raw polymer/energy cost, customer price and margin, FX and freight assumptions | [S2] |
| AG-A2 | Packaging — metal cans | Arabian Can Industry; three-piece tin cans | can units, tinplate input/yield, coating/printing, line utilization, price/volume and gross margin | [S2] |
| AG-A3 | Packaging — corrugated | Arabian Packaging; corrugated solutions | cartons/area, paper inputs, conversion/yield, customer volumes, plant overhead and margin | [S2] |
| AG-A4 | Metals — steel | Al Ghurair Iron & Steel; steel rolling/galvanizing | tonnes, purchased input cost, yield, galvanizing and power costs, capacity, standard-vs-actual margin | [S2] |
| AG-A5 | Metals — aluminium | Gulf Extrusion; aluminium extrusion | tonnes, alloy/input costs, energy, scrap/recovery, finishing, utilization and customer margin | [S2] |
| AG-A6 | Metals — automotive industrial | Gulf Extrusion Automotive & Industries / Gulfex Auto | product/customer volume, material, tooling/precision processing, labor, scrap and gross margin | [S2] |
| AG-A7 | Real estate — malls/retail | BurJuman Centre and Reef Mall shown on group's real-estate page | leasable area, occupancy, rent/lease expiry, arrears, service charges and property operating cost; retail landlord metrics vs tenant revenue must remain distinct | [S3] |
| AG-A8 | Real estate — residential/commercial | apartments, villas/townhouses, offices/showrooms, warehouses, car parks and land bank | unit or square-foot occupancy, rent, vacancy, renewals, operating costs, collections and asset cash flows | [S3] |
| AG-A9 | Real estate development | P.O.B1 Properties shown as development division | project phasing, land/build cost, sale/collection milestones, WIP and cash forecasts; recognition follows approved policy | [S3] |
| AG-A10 | Strategic investments | Site names minority positions in Mashreq Bank and National Cement Company | holding-level valuation assumptions, ownership %, dividends, contributions/disposals and cash; do not automatically model as controlled subsidiaries or provide bank regulatory computations | [S4] |
| AG-A11 | Portfolio investments/family office | Public/private market investments | asset, cost/value, expected distributions, fees, liquidity and scenario cash; valuation recognition and confidentiality per policy | [S4] |

The industrial page describes **seven active companies**, but its retrieved list displays six named companies (three packaging, three metals). Do **not** invent the seventh; ask for confirmation. The group homepage says Arabian Flexible Packaging was sold in 2025; do not include it as a current entity merely because older sources list it. Historical modeling can support disposals once approved. [S1–S2]

## Public portfolio B — `al-ghurair.com` (user-included scope)
Include in the business coverage inventory alongside portfolio A: foods (manufacturing/ingredients), development (project economics), mobility (vehicles/services/fleet), infrastructure (construction/materials/project drivers), property management (occupancy/rents/services). The public current site lists these five sectors. [S5] Earlier pages refer to other categories; do not silently treat historical pages as current entity list. Create separately reviewed templates for each, using the same platform and confidentiality controls. The user says both sites belong to the target group; exact legal relationships and inclusion in each consolidated reporting perimeter still require finance records.

| Scope ID | Sector on public site | Example planning coverage to specify |
|---|---|---|
| AG-B1 | Foods | sales/production volume, input materials, plant utilization, inventory and unit margin |
| AG-B2 | Development | land/project budgets, milestone sales and receipts, construction and project cash flow |
| AG-B3 | Mobility | vehicle/fleet volumes, service utilization, revenue, acquisition/maintenance costs and margin |
| AG-B4 | Infrastructure | project orders, resource/capacity, materials, project costs and forecast cash |
| AG-B5 | Property management | occupied/available area, lease/rent cash, services and operating-cost drivers |

These are planning hypotheses, not confirmed group reporting entities or claims of a completed feature. Detailed coverage, KPI definitions and acceptance per business need senior approval.

## Requirement impact: all business coverage vs production depth
The user asks to include all businesses: the **pilot specification must inventory every public business area above and include a generic monthly planning/reporting route for each**, with business-specific labels, units and input fields; validate actual list with the senior. This is a design and release target, not a claim these packs have already been built. Dedicated detailed accounting/supply-chain engines for each niche require separate tests and can be incrementally released after agreement; no shallow template may be represented as a full vertical solution.

### Proposed P0 capabilities for the senior's pilot (scope confirmation required)
- One local user, multiple labeled legal-entity/business-unit datasets within a single encrypted workspace; independently imported monthly source data, individual currency metadata, periods, accounts, scenario and ownership metadata. This **changes the earlier one-entity V1 assumption** but not single-user access.
- Use a shared planning model (actual/budget/forecast/variance) for all confirmed verticals; mapping editor and template fields for every applicable A1–A11 and B1–B5 area. Sample inputs are synthetic and not named as real data.
- Per-business TB/P&L review, variance, driver assumptions, notes and drill-to-source; support empty/unavailable areas as `NOT_PROVIDED`, never zero or 'complete'.
- Cross-business management view can show rows side-by-side. Sum only pre-approved comparable measures where periods, currency, classifications and reporting scope match. Imported divisional results can already contain intercompany transactions; a sum is **unadjusted** and must be labeled `Management sum — not consolidated` with included/missing entity disclosure. Different-currency data must remain separate unless explicit reviewed translation and rates exist.
- True group consolidation is **a confirmed V1 requirement**. Define its required foreign-currency, intercompany, equity-accounting, NCI and statement scope with an expert-owned design, realistic source data and test suite; do not release V1 without the approved consolidation requirements. A single-user desktop can analyze multiple entities; it does not imply multi-user collaboration, nor automatic consolidation.
- Native 64-bit Excel add-in is mandatory; read values by explicit workspace/entity/scenario/period/revision and push a selected reviewed range with all-or-nothing/revision/audit controls. Office 2021 64-bit confirmed; exact edition/build and policy remain unconfirmed. Detailed contract: `11-uae-excel-v1.md`.
- UAE defaults and manual tax inputs are not automatic FTA filing or claims of tax compliance. The location/group name does not determine mainland/free-zone status or tax-group membership; the senior must identify each relevant legal entity and policies.

### P0/P1 coverage table: functional depth
| Area | Proposed baseline for both user-included portfolios | Additional depth subject to SME / source data |
|---|---|---|
| Packaging/metals | monthly sales volume, price, revenue, input cost, operating expense, actual vs plan, segment KPI with declared units; manually entered capacity | BOM and multi-level product costing, yield/scrap and standard vs actual accounting, dynamic capacity, currency, freight/hedges, inventory valuation by selected policy |
| Malls/residential/commercial | manual rent/occupancy/operating-cost schedule and budget variance by property | tenant-level rent roll, CPI/abatement, service charges/recoveries, arrears and collections, lease accounting, project-specific recognition |
| Development | project revenue/cost/cash by month with explicit manual assumptions | cost-to-complete, WIP, recognition, detailed drawdowns, earned value and milestone contracts |
| Strategic/portfolio investments | separate asset input register with manual ownership, carrying value/dividend/cash assumptions; reporting outside operating EBITDA | equity method, consolidation assessment, fair-value hierarchy, complex disposals and valuation/reconciliation; accountant validation |
| Cross-business finance | mapped source-to-report, calendars, assumptions, scenarios, native Excel, audit and **true consolidation**; detailed IC/FX scope needs approval | additional cases beyond V1, regulated statutory filing and multi-user collaboration |

Coverage should be shown as `specification drafted`, `generic template implemented`, `tested on synthetic cases`, or `senior validated`, separately for every area. Never label a sector supported because a directory or placeholder exists.

## Illustrative group test fixture — synthetic, not company data
Period Jan, AED, one comparable accounting scope, no internal transactions assumed. Three independently imported business-unit P&Ls:
```
Business unit             Revenue   Operating expense   EBITDA*
Synthetic Packaging       1,000        750               250
Synthetic Metals          1,600      1,300               300
Synthetic Property          500        200               300
Management total          3,100      2,250               850
```
*Only if inputs are explicitly defined as EBITDA components; finance reviewer approves account mapping. Synthetic Investment has cash dividends of AED 100; show separately below operating KPIs, not silently inside EBITDA or combined as operating revenue. Label total **unadjusted management sum, not consolidated**. If Metals source is missing, show missing and suppress complete total (or provide prominently labeled partial total), never treat missing as zero. If one sector's currency differs or an IC indicator is unknown, no clean comparable total until reviewer resolves policy. Source mappings and report drill-through must show each contributing input and revision.

**Excel test:** `FPA.GET` returns Synthetic Packaging Jan EBITDA 250 for the requested revision. User selects an assumption cell, previews change, confirms once, and source revision/audit reflect the atomic change; GET updates only after documented refresh. Invalid unit/coordinate or stale revision fails without mutation. No formula UDF performs write-back.

## Data and access precautions
Senior testing does not imply corporate sponsorship, procurement approval or authority to transfer data. Use fictional records at first. Before any real sample, obtain written company authorization, approved processing/storage locations, legal/privacy/security review, least-privilege data access and confidentiality agreement where needed. Do not put corporate GL, employee data, contracts, workbook models or secrets in external AI chats, issue trackers, cloud CI, logs or public Git. Offline installed app alone does not guarantee that AI coding tools or build infrastructure are offline. Verify approved data handling, retention/deletion and incident contacts. No corporate logo/endorsement statement without permission.

## Interview for senior (no sensitive numbers required)
1. Which group legal entities, segments and finance team do you cover across the two user-included websites? Can you share a **public or sanitized** segment list?
2. What is the highest-value monthly planning/reporting problem? What does a useful first pilot demonstrate?
3. Does the first demo require a true consolidated statement, eliminations, or merely side-by-side / an unadjusted management view?
4. What periods, AED vs other currencies, data size, source systems and mapping granularity are in scope? Are internal ERP connections prohibited?
5. Which 64-bit Excel edition/build and organizational add-in signing/policy requirements apply? Can the test machine install an XLL and its offline prerequisites?
6. What exact Excel workflows are must-have: pull/report refresh, bulk push, comments, mapping or preservation of an existing template? Can a sanitized sample be provided with written approval?
7. Which 2–3 management reports and KPI definitions are accepted for each sector? How should investment dividends and minority holdings be shown?
8. Which data can be used, who authorizes it, and who independently approves accounting, UAE tax assumptions and security?

## Source register
- [S1] Al Ghurair Group official home: https://www.alghurair.com/ — three verticals; history notes 2025 sale.
- [S2] Al Ghurair Group official industrial page: https://www.alghurair.com/business/industrial/ — packaging, metals and displayed businesses.
- [S3] Al Ghurair Group official real estate page: https://www.alghurair.com/business/real-estate/ — malls, leasing and development.
- [S4] Al Ghurair Group official investments page: https://www.alghurair.com/business/investments/ — strategic minority positions and portfolio investments.
- [S5] Al Ghurair official home: https://al-ghurair.com/en/home — five sectors on the second user-included site; legal perimeter requires finance confirmation.
- [S6] Forbes Middle East 2026, Al Ghurair Group: https://www.forbesmiddleeast.com/lists/top-100-arab-family-businesses-2026/al-ghurair-group/ — secondary corroboration; not authority for financial treatment or private group boundaries.
