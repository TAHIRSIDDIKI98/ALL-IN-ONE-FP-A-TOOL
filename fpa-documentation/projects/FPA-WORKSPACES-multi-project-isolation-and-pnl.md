# FPA-WORKSPACES — Multi-Project Workspaces, Isolated CoA & Project P&L Spec

**Pack ID:** `FPA-WORKSPACES` · **Blocking Invariants Owned:** `I37`, `I38`, `I39` · **Verified Reference Engine:** `frontend-builder/src/lib/omniBlueprintEngine.ts` (Section 14)

---

## 1. Executive Mandate: Why Per-Project FP&A Isolation Exists

Multi-industry conglomerates and holding groups cannot operate inside one forced, monolithic Chart of Accounts (`CoA`). A real-estate tower built on **WBS Percentage-of-Completion (PoC)**, a multi-entity manufacturing group using **SAP S/4HANA `ACDOCA`**, an expanding **SaaS business unit in EUR**, and an industrial **CapEx plant modernization in GBP** have fundamentally distinct charts of accounts, cost structures, recognition formulas, and reporting currencies.

Atlas FP&A v4.0 introduces **sealed per-project FP&A workspaces** governed by three deterministic `BigInt` invariants (`I37`–`I39`).

---

## 2. Seeded Multi-Project Workspace Registry (`PRJ-01` – `PRJ-04`)

| Project ID | Workspace Name | Currency | ERP Profile | Model Paradigm | CoA Namespace (`I37`) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `PRJ-01` | **Aster Vale Group Conglomerate** | `USD` | `ERP-01` SAP S/4HANA (`ACDOCA`) | Consolidated Holding Operating P&L | `COA-HOLDING-IFRS` |
| `PRJ-02` | **Al-Noor Commercial Tower WBS** | `AED` | `ERP-02` Oracle Fusion (`GL_JE_LINES`) | WBS Milestone & IFRS 15 PoC Recognition | `COA-DEV-POC` |
| `PRJ-03` | **Atlas Cloud SaaS Expansion** | `EUR` | `ERP-04` NetSuite OneWorld | Multi-Region ARR & Cloud Deployment Rollout | `COA-SAAS-REV` |
| `PRJ-04` | **Gulf Packaging Line 4 CapEx** | `GBP` | `ERP-03` Dynamics 365 F&O | Plant CapEx Capitalization & Commissioning | `COA-MFG-CAPEX` |

---

## 3. Exact `BigInt` Governance & Invariants

### `I37` — Project CoA & Ledger Isolation Firewall
- Every financial workspace owns an isolated `coaNamespace` and mapped account dictionary.
- Any import staging row, manual journal, or Excel `=FPA.GET` / Command push whose `(projectId, coaNamespace, nativeAccountCode)` does not match the active target workspace is blocked immediately with `CROSS_PROJECT_COA_ISOLATION_VIOLATION`.

### `I38` — Cross-Project Multi-Currency Consolidation Guard
- Converting project P&L results into group reporting currency (`USD`) requires an explicit scaled-integer FX spot/average rate (`10^4` precision) for every participating project.
- **Missing ≠ Zero (`I04`/`I07`)**: If a project's currency pair rate is `null` (e.g., missing `EUR -> USD` rate), portfolio consolidation quarantines that project (`status: 'PARTIAL_EXCLUDED_MISSING_FX'`, emitting explicit `quarantinedProjectIds`) rather than coercing `0` or silently summing `1:1`.

### `I39` — Exact `BigInt` WBS, EAC, PoC % & Project P&L Conservation
- For every project (`PRJ-01`..`PRJ-04`):
  - $\text{EAC Cost} = \sum \text{WBS Actual Cost to Date} + \sum \text{WBS Estimate-to-Complete (ETC)}$
  - $\text{PoC \%} = \min\left(100.0\%, \text{roundHalfEven}\left(\frac{\text{Actual Cost}}{\text{EAC Cost}} \times 1000\right)\right)$
  - $\text{Earned Revenue} = \text{roundHalfEven}\left(\text{Contract Value} \times \frac{\text{PoC Tenths}}{1000}\right)$
  - $\text{Recognized Gross Profit} = \text{Earned Revenue} - \text{Actual Cost}$
- WBS child rows must reconcile to Project P&L headers with **`0n` (`0.00`) delta**.
