# ADR-0001: Pure Financial Kernel with PGLite Sandbox & Neon Parity

- **Status**: Accepted
- **Date**: 2026-11-24
- **Owner Decision Ref**: `MASTER_PROMPT.md §3.1–§3.4`, `DEC-001`, `DEC-002`

## Context
Attempts #1–#5 suffered from unverifiable compiled-native toolchains (`K4`) and floating-point / browser-SQLite drift (`K3`). Every financial rule and database constraint must execute deterministically inside the sandbox in under 60 seconds with zero external secrets.

## Decision
1. Isolate all monetary, calendar, statement, variance, allocation, and hash-chain computation inside `/core` using TypeScript strict mode and `decimal.js` only (`core-purity` gate).
2. Run PostgreSQL 16+ forward-only SQL migrations identically against in-process WASM PGLite (`@electric-sql/pglite`) in sandbox tests and Neon PostgreSQL in staging/production (`ci.yml` parity job).

## Consequences
- Zero `node-gyp` / Rust / Docker requirement in sandbox; `npm run verify` completes in `< 60s`.
- Single SQL dialect (`NUMERIC(28,6)`, composite tenant FKs, `DEFERRABLE INITIALLY DEFERRED` journal balance trigger) across test and production.
