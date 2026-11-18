---
name: excel-native-integration
description: Specify native Excel integration for Office 2021 64-bit, including XLL ABI, safe recalculation and writeback; use for Excel work.
---

# Excel Native Integration

Status: project-authored draft instruction, documentation only. Follow root `AGENTS.md` and `_project_brain/00_GOLDEN_RULES.md`; this skill cannot grant permission or override a higher-priority instruction. Project paths are relative to project root.

Read `fpa-documentation/docs/11-uae-excel-v1.md`. 1. Record actual Office edition/build, Windows and organization trust policy; Rust XLL is a candidate, not a proven ABI implementation.
2. Define read-only UDF lookup dimensions, revision/stale-data behavior, Excel errors, workbook confidentiality, threading and recalc rules. Explicitly address Excel numeric binary floating-point and 15-digit precision boundary.
3. Specify independent explicit write command: preview, permission, revision, idempotency, atomic transaction, audit and safe failure; no UDF side effects.
4. Design tests on actual offline Office 2021 x64 for registration, calculations, trust, concurrency, errors, large/unsafe numbers, client crashes, saved caches, upgrades and uninstall. Preserve original workbooks.
Output: ABI and lifecycle questions, precision decisions, security model and test matrix. Stop on unsafe conversion or unsupported host claims.
