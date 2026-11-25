# Changelog

All notable changes to OneFP&A are recorded here under Semantic Versioning (`MASTER_PROMPT §12.15`).
Every claim maps to a `VERIFIED` gate in `TASKBOARD.md` (`Q6`).

## [0.2.0] - 2026-11-25 (M1 The Spine — in progress)

Milestone M1 is **not** complete; these are the verified increments so far (evidence in `TASKBOARD.md`).

### Added
- Spine persistence on PGLite/Postgres behind one `SqlExecutor` contract, audited atomic company setup, and session boundary (`WI-0012`, `WI-0013`).
- Schema-parity gate comparing migrations against the committed snapshot, plus the CI-gated Neon leg (`WI-0014`).
- Atomic idempotent import commit keyed on `(company_id, kind, source_hash)` with per-source replacement, full row accounting and chained audit (`WI-0015`).
- Trial balance + drill-to-source read model over active batches only (`WI-0016`), exposed over HTTP with typed errors and body ceilings (`WI-0017`).
- Year-to-date articulating statements (P&L / BS / indirect CF / retained earnings) with A1–A5 checks over HTTP (`WI-0018`).
- Browser API client, sign-in/setup wired to the API (`WI-0019`), server-driven statements screen (`WI-0020`), and a Playwright harness that drives the real API (`WI-0021`).
- Import Wizard + Model Grid served from the API, with ONE import classifier shared by a read-only company-scoped preview and the commit (`WI-0022`).
- Chart of accounts: pure CSV parser/validator (`/core/chart`), atomic audited chart import and chart read model over HTTP, and a working CoA screen — an import can now post instead of quarantining every row as unmapped (`WI-0023`).

### Changed
- S-COMMIT (INT8) is enforced from an objective codex boundary (`DEC-007`) instead of a fixed-size exemption list.

## [0.1.0] - 2026-11-24 (M0 Foundation)

### Added
- Bootstrapped repository layout, constitutional governance (`MASTER_PROMPT.md` v1.2, `SPEC.md`, `TASKBOARD.md`), and GitHub Actions CI diagnostics (`WI-0001`).
- Implemented sandbox structural gates and ported honesty detectors `P01`–`P04` (`WI-0002`).
- Ported typed error catalog `P12` and canonical `zod` wire contracts (`WI-0003`).
- Ported and verified `/core/money` Decimal primitives, parser, string serializer, and largest-remainder allocator (`WI-0004`).
- Ported `P09` Class A NRF 2024–2028 calendar fixtures and verified `/core/calendar` generator `P10` (`WI-0005`).
- Ratified `MASTER_PROMPT.md` v1.2–v1.3 (Parts 11–13), third-party license compliance (`LIC1–3`), ADRs (`VER3`), and mechanical Work-Integrity Codex scanners & ratchet (`INT1–INT13`, `WI-0005B`, `WI-0005C`).
- Ported `/core/audit` pure TypeScript FIPS 180-4 SHA-256 canonical JSON hash chain (`WI-0006`, `P11`).
- Authored 18-table Postgres M1 schema migration (`0001_m1_spine.sql`), deferred balance & row-accounting triggers, append-only audit triggers, and PGLite constraint test suite (`WI-0007`).
- Ported Class A CoA (`P15`) & statement (`P18`) fixtures and verified `/core/statements`, `/core/variance`, and `/core/invariants` passing EBITDA `+300` and A1–A5 (`WI-0008`, `P17`, `P19`).
- Built deterministic plan-first Coherent Corpus v1 generator, `/core/import` messy CSV parser, synthetic messy-export manifests, and independent non-`/core` BigInt oracle verifier (`WI-0009`).
- Wired Express 5 spine API server, React 7-screen spine shell (`SignInPage`..`BoardPackPage`) with WCAG AA landmarks & five-state foundations, and Playwright E2E harness (`WI-0010`).
