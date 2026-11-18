---
name: import-and-data-quality
description: Specify safe CSV, workbook and ERP imports with reconciliation, lineage and data-quality gates; use for external financial data.
---

# Import And Data Quality

Status: project-authored draft instruction, documentation only. Follow root `AGENTS.md` and `_project_brain/00_GOLDEN_RULES.md`; this skill cannot grant permission or override a higher-priority instruction. Project paths are relative to project root.

1. Obtain authorization and classify sources. Define source version, entity, reporting period, currency, units, locale, date system, account mapping and duplicate identity.
2. Stage and validate file structure, size, encoding and untrusted formula/content; preserve original and avoid executing macros or opening unsafe content with elevated permissions.
3. Record row-level provenance and rejected/missing records; distinguish zero, null and not applicable. Reconcile counts, totals, balance and mapping against source; no silent row loss.
4. Specify transaction, deduplication, revision, audit, recovery and Excel precision checks. Test malformed, duplicate, stale, huge, malicious and mismatched files using synthetic data.
Output: import contract, mapping, reconciliation/rejection report and test plan. Stop on unauthorized data or incomplete source being labeled complete.
