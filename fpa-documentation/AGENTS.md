# Mandatory instructions for AI and human contributors

## Authority and startup
Read `README.md`, `docs/06-agent-system.md`, the release scope, relevant specs/ADRs and task before changing files. Report task ID, linked requirements, assumptions, planned files and tests. If instructions conflict with an accepted invariant or exceed scope, stop and ask. Draft documents are proposals, not approval.

## Rules
1. Work only on the assigned ticket and smallest coherent change. Never silently add runtimes, dependencies, network calls, telemetry, features or invented claims.
2. Five intended languages: Rust, TypeScript, Go, Java and Elixir, to be used when needed. Exact production architecture and any C/C++ fallback remain unapproved. Native offline Excel is required in V1, but its ABI and technology are unproven.
3. Link every feature requirement → design → task → tests → evidence. Update docs and changelog with code; create ADRs for material design/security/finance choices. Preserve backward compatibility or provide reviewed migration/rollback.
4. Results must be correct and reproducible. Never substitute AI explanations for authoritative calculation. Unknown accounting policy, ambiguous mapping, unsupported formula, loss of fidelity or missing rate is an explicit error/review, never silent zero.
5. Fail closed for authorization; no secrets or sensitive finance data in logs by default; no unapproved network or runtime downloads. Validate untrusted files and IPC. Use vetted crypto, never invent it.
6. Test behavior and error cases. Never claim a test passed if it did not run. Record commands, OS, results and environmental limitations. A Linux check is not Windows verification.
7. Never alter or delete user data to make tests pass. Use synthetic fixtures; backup before migration; never bypass failed gates or mark placeholders as implemented.
8. Pin and license dependencies, generate SBOM and provenance through release. Version changes require compatibility/offline checks.
9. One authoritative owner writes each project; sidecars cannot write databases directly. No secrets, signing keys, real payroll or customer data in Git or fixtures.
10. Report requirements satisfied, changed files, tests/results, risks and next ticket. Update `STATUS.md`; leave blockers visible.

## Required workflow
Inspect → cite requirements and ADRs → propose acceptance tests → implement small slice → run tests → update docs/traceability/status → request finance/security/recovery review → present evidence. Do not start another ticket automatically when human approval is pending.

## Stop conditions
Unclear financial semantics; weakened offline/security guarantees; destructive migration without recovery; license uncertainty; unexpected exposure; unexplained test failure; unverified performance claim; inability to verify target Windows behavior.


## Confirmed v0.3 pilot
UAE, single user, native 64-bit Excel integration required in V1. Plan covers the senior tester’s Al Ghurair businesses with multiple business units/entities, without assuming statutory consolidation. Read docs 14–15 and 19: both public portfolios are in scope per user, but legal entities and consolidation control cannot be inferred from public branding. Synthetic data only unless explicitly authorized.


## v0.4 readiness gate
Read docs 16–18 and the requirement register. Portfolio identity, customer data authorization, Excel version, scope depth and consolidation must not be inferred. Agents must treat all tests as unrun unless accompanied by actual evidence. `fixtures/synthetic` is fictional and is not a GL fixture or an approved accounting oracle.


## v0.5 Secondary Brain protocol — mandatory
Before every task read `../_project_brain/00_GOLDEN_RULES.md` and `../_project_brain/04_ACTIVE_STATE_AND_TASKS.md`; inspect actual repository and relevant brain files. Both Al Ghurair websites are in target scope per user, without assuming their legal consolidation boundary. True group consolidation and native Office 2021 64-bit integration are V1 requirements. Update Brain and affected documentation after every task. Do not begin Task #1 until owner approval.
