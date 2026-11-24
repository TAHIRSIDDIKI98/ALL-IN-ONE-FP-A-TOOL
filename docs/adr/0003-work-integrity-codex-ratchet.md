# ADR-0003: Work-Integrity Codex (Zero-Shortcut Law) & Mechanical Ratchet

- **Status**: Accepted
- **Date**: 2026-11-24
- **Owner Decision Ref**: `MASTER_PROMPT.md` Part 13 (`DEC-004`)

## Context
Part 13 establishes the Work-Integrity Codex: zero placeholders, zero suppressions, zero dead controls, zero swallowed errors/debug leftovers, zero tests without assertions, mandatory per-item verbatim self-audit attestation (`§13.9`), and a monotonic quality ratchet (`§13.8`).

## Decision
Implement `/scripts/work-integrity.mjs` inside `npm run verify` enforcing `INT1–INT13` and scanners `S-PLACEHOLDER`, `S-SUPPRESS`, `S-DEAD-CONTROL`, `S-TEST-INTEGRITY`, `S-SWALLOW`, `S-DEBUG`, `S-COMMIT`, `S-CUTLINE`, and `S-RATCHET` (`scripts/integrity-ratchet.json`), with planted-violation tests in `scripts/gates.test.ts`.

## Consequences
- Any `TODO`/`FIXME`/`HACK`/`not implemented`, empty `catch {}`, `console.log`/`debugger` in product code, `<button>` without action/submit, `it()` without `expect()`, out-of-phase directory/route, missing `VERIFIED` attestation, or regressed metric immediately fails `npm run verify`.
