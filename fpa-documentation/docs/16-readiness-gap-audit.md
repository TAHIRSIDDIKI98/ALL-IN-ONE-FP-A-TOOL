# 16 — Documentation readiness audit and gap register

**Status:** Draft v0.4 · **Date:** 18 November 2026. This is a planning audit of documents, not an audit of implemented software. No application, benchmark, security test, Excel test or client approval is claimed.

## Executive assessment
The pack explains a vision, proposed architecture and some finance/security risks. True consolidation, both-site business coverage and Office 2021 x64 are now user-confirmed V1 direction. It is **not yet a sufficiently approved implementation specification**. In particular, the exact legal entity and consolidation boundary remain unidentified; “include all businesses” has not yet been translated into accepted capabilities per business; the existing specs are not a complete financial or Excel API; and no customer, finance or security reviewer has signed off. The correct next step is targeted discovery and bounded, reviewed specs—not asking an agent to build all modules.

## Priority definitions
- **BLOCKER:** cannot safely authorize the affected coding task or pilot release until resolved.
- **P0:** required evidence/spec before any real-data pilot; details may be authored incrementally.
- **P1:** needed for a trustworthy commercial/expanded release; do not silently market it as present.
- **P2:** future capability; not required for initial technical validation unless customer says otherwise.

| ID | What is missing / why it matters | Priority | Owner needed | Evidence to close |
|---|---|---|---|---|
| GAP-001 | Both public websites are in user-provided target scope; legal entity/control perimeter, senior role and consent still need confirmation | BLOCKER for consolidation specification | User + senior | Authorized sanitized entity/BU/control list and date |
| GAP-002 | “All businesses” definition: complete portfolio roster and minimum common workflow versus required sector-specific depth | BLOCKER for release scope | Senior/product | Signed matrix per business: source, required inputs/KPIs/report, scope and acceptance |
| GAP-003 | True consolidation is mandatory; exact IC/FX/NCI, ownership and output requirements are unspecified | BLOCKER for consolidated V1 | Group finance SME | Approved policy, entity perimeter, report specimens, goldens and tested scope |
| GAP-004 | Office 2021 64-bit confirmed; exact build, add-in policy, signing/install remain unknown | BLOCKER for Excel design | User/IT | Offline test on target Excel; supported matrix and evidence |
| GAP-005 | Project ownership of data and written authorization; confidential source files cannot be placed into outside AI/tools by default | BLOCKER for real data | Company data owner + IT/legal | Written permission, data classification, environment, retention, allowed tooling |
| GAP-006 | Independent finance, UAE tax/legal and security review capacity | BLOCKER for production claims | User + qualified reviewers | Named independent reviewers, scope, signed findings and disposition |
| GAP-007 | Detailed model and report semantics: chart, sign, debit/credit, ledgers, closing, period locks, currency, classifications, materiality | P0 | Finance owner | Approved accounting policy and golden cases per relevant entity |
| GAP-008 | Native Excel exact product contract: identity, unlock, revision pin, save/reopen, precision, offline trust, UI command and crash outcomes | P0 | Excel/Windows lead | Approved spec + verified real-Excel prototype and matrix |
| GAP-009 | Authoritative privacy threat/data-flow inventory incl. temp, swap, crash dump, clipboard, Excel cached workbook values, backups and AI prompts | P0 | Security/IT | Data-flow diagram, asset classification, leak tests, residual-risk sign-off |
| GAP-010 | Offline recovery keys, physical backup custody, corrupt media, expected RPO/RTO and restore evidence | P0 | IT/data owner | Recovery runbook, defined targets and real restore test on second profile/device |
| GAP-011 | Atomic cross-artifact commit, idempotency and approved rejection/replay behavior | P0 | Storage lead | Versioned state machine, request status/outcome tests and fault evidence |
| GAP-012 | Representative workload model and hardware/Windows/Excel compatibility matrix | P0 | Senior + QA | Approved dimension sizes, records, expected jobs; reproducible baseline and measured performance |
| GAP-013 | Scope- and policy-correct sector blueprints and validated KPIs | P0 for each promised sector | Finance/operational SME | Model dictionary, specimen reports, assumptions, synthetic goldens and clear supported limits |
| GAP-014 | UAE employment/gratuity, VAT/CT, applicable standards and privacy rules; applicability varies by legal entity and date | P0 if feature offered | UAE-qualified legal/finance | Versioned policy content with citations, effective dates, applicability and human approval |
| GAP-015 | Named approval process for releases, documentation and legal/compliance claims | P0 | User | Role assignments, approval evidence and release checklist |
| GAP-016 | Reference-engine details and independent oracles incl. exact numeric policy and failure/error semantics | P0 | Finance + engineer | Approved spec, manual goldens, independently authored evaluator and differential tests |
| GAP-017 | Operational support: user manual, incident/restore playbooks, support boundaries and export/retrieval | P0 | User/IT | Tested offline help and recovery, redacted diagnostics, ownership and exit plan |
| GAP-018 | Full accounting consolidation model for mandatory V1 scope: ownership/control, IC, CTA, journals, NCI and dates | BLOCKER for V1 release | Group consolidation SME | Approved detailed design, synthetic cases and independent reconciliation |
| GAP-019 | Migration/version compatibility and uninstall / business continuity | P0 | Release lead | Forward/backward support matrix, pre-migration backup and tested downgrade/restore |
| GAP-020 | Dependency and model-weight licensing, offline packaging, update/signature policy, SBOM and provenance | P0 before release | Release/legal | Inventory with versions/rights, signed package test, security patch process |
| GAP-021 | AI-tooling governance, source ownership, code-generation provenance and data access; unlimited tokens are not a trust boundary | P0 | Owner/security | Written policy, approved tools/environments, isolated synthetic fixtures, human approvals |
| GAP-022 | Business goals and pilot acceptance: who signs off, what task is faster/better, blockers and success metrics | P0 | Senior + product | Signed UAT plan, representative before/after workflow and exit thresholds |
| GAP-023 | Customer-ready commercial terms, support, liability/insurance and branding | P1 | User/legal | Approved terms and no unauthorized endorsement |
| GAP-024 | Connectivity boundaries: local IPC is still a socket/pipe, company firewall, no internet vs no network, ERP unavailable in air gap | P0 | IT | Threat-tested process connection inventory and disconnected-device evidence |
| GAP-025 | Accessible editable grid and Excel-specific accessibility across DPI/locale | P1 or P0 if pilot policy requires | QA/IT | Keyboard/screen reader tests on actual Windows + Excel |

## Highest-risk contradictions resolved in v0.4
1. **One user vs one entity:** the user confirmed one user, not one entity. Multiple entities/business units and true consolidation are required; accounting detail and reporting perimeter need approval.
2. **Industry completeness:** all confirmed business areas must appear in the scope/coverage register. A generic manual-input template is not a fully featured sector engine and cannot be represented as one. Senior must approve the depth per area.
3. **Offline:** core works without external connectivity; locally installed Excel is required for the mandatory add-in. A network-disabled VM is not necessarily proof of all no-egress claims: inspect actual process network activity, OS policy, DNS and update behavior.
4. **Audit/permissions:** locally encrypted/tamper-evident is not immutable, independent segregation or SOX certification. Single-user OS/key access does not produce enterprise-level role isolation.
5. **DuckDB:** disposable does not mean nonsensitive; encrypt the projection, temporary spill and backups or use a reviewed encrypted-storage design. No direct sidecar writes.
6. **Excel:** calculated values can be cached in the workbook and persist after core is shut down; UI cannot reliably erase every already-saved copy. Treat workbooks, clipboard, exports, Office AutoRecover, temp files and user-created copies as sensitive and document controls.
7. **Research:** public company pages describe areas, not internal entity, ownership percentage, reporting basis or permission to test. The senior's written input supersedes guesses about their internal scope.

## Readiness gates
- **Documentation ready for a particular task:** requirement/spec/state/error/tests approved; owner and reviewer identified; unknowns affecting that task resolved. Other future docs may remain draft.
- **Internal synthetic prototype:** narrow documented scope, no confidential client data, known limitations, no claims of production readiness. Security mechanisms can be prototyped but must not be advertised as verified.
- **Real-data pilot:** company authorization, data controls and legal review, accountant/security review, Excel and recovery gates, explicit participant consent and emergency process.
- **Production release:** complete applicable UAT and test evidence, independent review and owner sign-off, licensing/signing/support/update/runbook controls and unresolved risk acceptance. A green test suite alone does not constitute these approvals.

## Sources used for additional gaps
- Microsoft, floating-point precision in Excel: https://learn.microsoft.com/en-us/office/troubleshoot/excel/floating-point-arithmetic-inaccurate-result
- Microsoft, Excel multithreaded/XLL restrictions: https://learn.microsoft.com/en-us/office/client-developer/excel/multithreaded-recalculation-in-excel
- SQLite, online backup: https://www.sqlite.org/backup.html
- UAE government, end-of-service benefits with different worker categories/savings scheme: https://u.ae/en/information-and-services/jobs/Sector-of-employment/employment-in-the-private-sector/end-of-service-benefits-for-employees-in-the-private-sector
- Personal-data regime and sector applicability must be checked with qualified counsel against current primary law, the relevant entity and location; no automatic applicability claim here.
