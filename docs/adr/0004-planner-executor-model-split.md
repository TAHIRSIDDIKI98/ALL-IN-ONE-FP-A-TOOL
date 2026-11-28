# ADR-0004: Two-Tier Planner / Executor Model Split & Low-Level AI Execution Protocol

- **Status**: Accepted
- **Date**: 2026-11-28
- **Owner Decision Ref**: `MASTER_PROMPT.md` Part 14 (`DEC-025`)

## Context
OneFP&A enforces 16 mechanical verification gates (`npm run verify` `< 60s`), strict TypeScript (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), decimal-only financial math (`money-ast`), pure `/core` isolation (`core-purity`), immutable SQL constraints/triggers (`schema-parity`, `schema-scope`), and the Work-Integrity Codex (`INT1–INT13`). The owner directs operating in a two-tier model split: **Gemini Neon** performs architectural planning, invariant derivation, schema/blueprint authoring, and post-slice audits, while **Gemini 3.5 Flash-Lite** (a lighter, faster execution model) performs bounded implementation turns.

Without explicit structural rails, lighter models face four predictable failure modes on a strict repository: (1) missing rules buried at line 2,200+ of a long constitution, (2) inferring conventions across dozens of files and tripping strict TS / AST / layout gates, (3) taking on multi-layer slices that exceed reliable context/diff capacity or breach the 60-second verification ceiling via extra PGlite test files, and (4) looping on failing gates or weakening assertions instead of escalating.

## Decision
1. Upgrade `MASTER_PROMPT.md` to **v1.4** (`DEC-025`) by inserting a concise **Two-Tier Session Startup Banner** at the top of the file and appending **Part 14 (`§14.0`–`§14.9`, Gates `PE1–PE5`)** while keeping Parts 1–13 intact (`§11.17`).
2. Establish a strict authority split (`§14.1`): **Gemini Neon** owns architecture, `DEC-###` decisions, ADRs, `MASTER_PROMPT.md`, gate scripts, oracle expected values, `package.json` dependencies, 8-part Execution Blueprints, and post-slice audits; **Gemini 3.5 Flash-Lite** executes strictly one pre-blueprinted atomic sub-WI (`WI-####A` pure core/shared/oracles, `WI-####B` SQL/repo/HTTP, or `WI-####C` client/UI tab) per turn/commit (`PE1`, `PE2`, `PE3`).
3. Add **Section 7** to `SPEC.md` housing a **Low-Level AI Codebase Conventions & Anti-Trap Cheat-Sheet**, the **Standard 8-Part Execution Blueprint Template**, and active ready-to-execute blueprints (beginning with `WI-0048A`/`B`/`C`), kept synchronized with `/docs/user-guide/` (`DOC2`).
4. Enforce a **Two-Attempt Hard Stop & Escalation Protocol (`PE4`, `§14.7`)**: after two consecutive failed attempts on the same error, any blueprint ambiguity, or a `verify > 60s` breach, the Executor stops immediately, logs exact output in `TASKBOARD.md §Blockers`, and hands back to Gemini Neon.
5. Extend `scripts/constitution-check.mjs` (`GOV2`) to enforce Parts `1..14` and zero dangling `§14.x` references, proven by a planted-violation test in `scripts/gates.test.ts`.

## Consequences
- Every arriving agent session (Neon or Flash-Lite) detects its role and minimal-context reading order from the very first screen of `MASTER_PROMPT.md`, while `AGENTS.md`/`GEMINI.md`/`CLAUDE.md` remain untouched (`scripts/repo-layout.test.ts` green).
- Zero quality gates or financial invariants are weakened for Flash-Lite; instead, design ambiguity is eliminated up front inside `SPEC.md` Section 7 blueprints.
- All 16 gates in `npm run verify` remain green under the 60-second budget, with explicit PGlite test-handle reuse rules preventing verification-time creep across M3 execution slices.
