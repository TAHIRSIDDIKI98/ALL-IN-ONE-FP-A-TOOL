# ADR-0002: Master Prompt v1.2 Cross-Cutting & Second-Order Contracts

- **Status**: Accepted
- **Date**: 2026-11-24
- **Owner Decision Ref**: `MASTER_PROMPT.md` Parts 11 & 12 (`DEC-003`)

## Context
Parts 1–10 defined the M0–M1 spine and Vision Ledger, while cross-cutting systems (connectors, async jobs, optimistic concurrency, forecasting drivers, semantic metrics, FX/consolidation, AI evals, observability, temporal cut-offs, prompt-injection defense, SOX/DSR, ADRs, and license compliance) needed explicit architectural contracts upfront so early schema/kernel choices never require rewrites.

## Decision
Ratify `MASTER_PROMPT.md` v1.2 (appending Part 11 and Part 12) under the strict Cut-Line Law (`§2.3`, `§11.0`, `§12.0`):
- M0 gates immediately active: `GOV1–GOV3`, `TST1`, `VER1/VER3`, `LIC1–LIC3`.
- M1–M6 contracts are recorded now and implemented strictly when their phase gate opens.

## Consequences
- `constitution-check`, `license-check`, and `adr-check` run inside `npm run verify` starting in M0.
- Zero scope creep (`K1`) into M2–M6 code while M0/M1 gates are active.
