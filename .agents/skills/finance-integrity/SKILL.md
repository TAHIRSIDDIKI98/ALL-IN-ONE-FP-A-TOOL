---
name: finance-integrity
description: Specify and review financial calculations, linked statements, journals, decimal precision, audit and idempotence; use for accounting or money changes.
---

# Finance Integrity

Status: project-authored draft instruction, documentation only. Follow root `AGENTS.md` and `_project_brain/00_GOLDEN_RULES.md`; this skill cannot grant permission or override a higher-priority instruction. Project paths are relative to project root.

Read `fpa-documentation/docs/03-finance-engine.md` and Brain 00. 1. Identify financial scope, period, entity, currency, unit, scale, rounding, sign conventions, assumptions and source revision; confirm reviewed accounting policy.
2. Build a small synthetic balanced example and expected statement impact, including equity and cash-flow linkages; independently recompute expected values. Never treat a nonzero trial-balance difference as a plug.
3. Specify decimal/scaled-integer operations, overflow, missing/zero behavior and input/output conversion; no binary float in authoritative money calculations.
4. Define atomic transaction with data, revision, persistent scoped idempotency key/request hash and append-only audit. Check retry, conflict, reversal, rollback, disk full and crash cases. Do not call hash chains immutable against a privileged attacker.
Output: worked fixture, invariant list, negative cases, traceability and outstanding accountant review. Stop on unapproved policy or false completeness.
