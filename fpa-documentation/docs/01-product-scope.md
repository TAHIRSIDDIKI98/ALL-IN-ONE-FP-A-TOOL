# 01 — Product, scope and capability catalogue

## Vision and boundaries
An offline-first desktop workbench for financial planning, reconciled analytics and explanatory reporting. Extend across industries through versioned domain packs, not a promise that all local accounting and statutory requirements are correct out of the box. V1 is a single-user Windows 11 x64 application with core planning without internet, account, activation, external model download, connector, AI or Excel installation. Native offline Excel add-in is required for V1, but that integration necessarily requires a compatible licensed desktop Excel installation. ARM64 is later and separately tested. LAN is not an air gap.

### Initial assumptions requiring approval
Confirmed target geography UAE; proposed starting pilot is an Al Ghurair Group multi-business, multi-entity management-reporting workspace with monthly planning, AED default, configurable calendars and a 12-month forecast. Both websites are within target coverage per user; the legal entity set, tax and accounting policies remain unconfirmed; do not assume them. True group consolidation is a V1 requirement; scope and accounting policy must be approved. See `14-al-ghurair-group-pilot.md` and `15-portfolio-implementation-and-uats.md`. English UI and accessible keyboard operation. User owns device and can edit the local project. Customer validates accounting policies. No claim of audited financial statements or statutory compliance. Involve a finance SME throughout.

### Personas and journeys
- Analyst: create project → import GL/map accounts → validate and reconcile → build drivers → forecast → compare → explain → export and back up.
- Finance manager: review mappings, assumptions, exceptions and audit → approve scenario locally. A solo offline approval is a workflow record, not independent identity proof.
- IT/security: install offline → configure policies/recovery → update using signed package → verify logs and restore.
- CFO: see reproducible statements, dashboard, scenario and commentary backed by sources.

## V1 scope (proposed; all gates apply)
| ID | Outcome / acceptance |
|---|---|
| PRD-001 | Installer and prerequisites work with physical network disconnected; no account required. |
| PRD-002 | Single-user workspace with month/fiscal calendar, multiple separately identified entities/business units and currency metadata, account hierarchy, scenarios and model metadata. Unadjusted side-by-side reporting is not consolidation; actual consolidation is required. |
| PRD-003 | Defined CSV import, preview, mapping, validation, idempotent retry and reconciliation; no silent drops. |
| PRD-004 | P&L actuals and editable monthly forecast; typed formula errors, dependency trace and defined rounding. |
| PRD-005 | Linked balance sheet and indirect cash flow for supported mappings; balance/cash bridge controls; unresolved controls block approved export. |
| PRD-006 | Base and scenario branches, compare results, explicit conflict detection before applying changes; no concurrent sync. |
| PRD-007 | Actual vs budget/forecast variance table, saved view, CSV and simple XLSX export; sensitive values authorized. |
| PRD-008 | Committed mutations and imports auditable; encrypted checkpoint/export and verified restore on fresh profile. |
| PRD-009 | Correct affected recalculation and drill from reported number to mappings, formula, batch and source record where available. |
| PRD-010 | Accessible virtualized grid, keyboard, validated copy/paste, undo as compensating action and visible save/error state. |
| PRD-011 | Native offline Excel add-in in the supported, locally installed Windows Excel edition: read a model value, refresh to a known revision and explicitly submit a reviewed write-back. See `11-uae-excel-v1.md`. |
| PRD-012 | AED defaults, configurable fiscal periods, UAE-specific manual VAT/corporate-tax planning assumptions and explicit review flags; no automatic filing or unsupported tax determination. |

**V1 requirements:** true group consolidation is mandatory; detailed treatment of IC, FX and ownership requires finance approval. **V1 exclusions unless owner respecifies:** statutory filing and tax automation, direct ERP, arbitrary Excel workbook round-trip, live multi-user, cloud, local AI, advanced industry packs, optimization, simulations, marketplace and enterprise certification. Design hooks do not imply feature availability.

## Long-term capability map
| Capability | Later scope and prerequisites |
|---|---|
| Model platform | custom dimensions, effective-dated/alternate hierarchies, units, formula library, scenarios, audit, model builder and validated semantics. |
| Planning | annual/rolling, ZBB, top-down/bottom-up, spreading, allocations, locks, approvals and commentary; real approvals require identity/control design. |
| Consolidation | ownership, acquisitions/disposals, FX/CTA, NCI, equity method, IC matching, eliminations, goodwill and journals; accountant-owned specs. |
| Workforce | positions/employees, hires/exits, merit, benefits, incentives, taxes, prorating; country rules and payroll privacy need review. |
| CapEx/treasury | assets/WIP/depreciation and book/tax; 13-week cash, working capital, debt/interest, revolver, covenants and liquidity. |
| Revenue/operations | contracts, deferred revenue, pipeline, product/customer/project drivers, unit economics, supply/capacity; policy reviewed. |
| Analytics | variance/PVM with published method, cohorts, sensitivity, simulations, goal seek and optional solver with status/gap. |
| Reporting | board packs, templates, CSV/XLSX/PDF/PPTX/DOCX and lineage; XBRL is a separately verified regulatory program. |
| Integrations | file drops/Parquet, approved ODBC/JDBC, desktop Excel; ERP vendor access, dependencies and licenses separately verified. |
| Governance | role/attribute policies, segregation, reviews, retention, external audit anchoring; enforcement depends on trust/deployment. |
| Collaboration | encrypted file exchange, managed LAN service or optional cloud; explicit identity, conflicts and key management. |
| AI | optional locally installed model; suggestions/citations, human approval and deterministic validation. |

## Industry packs
Pack = versioned metadata, dimensions, mappings, KPIs with explicit units/definitions, synthetic data, formulas, policy assumptions, validations, migrations and tests. No arbitrary executable code by default. Later candidates: SaaS (ARR/churn), manufacturing (BOM/cost), retail (4-4-5/4-5-4), healthcare (payer/PHI), banking/insurance (capital/provisions), construction (WIP), services (utilization), energy (commodity/ARO), hospitality/real estate (occupancy/NOI). Prioritize by pilot and domain-expert validation. 'All industries' means extensible, not universal certification.

## Success and non-goals
A finance reviewer reproduces source-to-report results, completes a forecast and restores offline using approved data. Baseline latency/adoption with named pilot hardware. This is not an ERP, payment processor, filing authority, general Excel replacement, investment adviser or autonomous accountant.
