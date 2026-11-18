# 05 — Roadmap, gates and risks

## Release strategy
Outcomes and gates drive schedule. This is a major product needing finance, Windows, security, QA and polyglot expertise; AI accelerates implementation but not independent verification. User confirms one AI-assisted builder, a Windows test machine and unlimited tokens; working hours and independent UAE finance/security review remain unknown. Dates are estimates, not commitments. One AI-assisted builder may take substantially longer than a staffed team. Run 2–4 weeks of spikes and measure throughput before estimating. Example pilot staffing assumption: product/finance SME, 2–4 experienced engineers covering Rust/Windows/UI/data, shared QA/security and review. The complete multi-industry/enterprise vision is multi-year and may need specialist teams.

| Gate | Deliverable and exit criteria |
|---|---|
| G0 Documentation | Owner approves product assumptions, threat model, finance sign/rounding, V1 boundary, target hardware and test criteria. Requirements traceability created. Only throwaway spikes before approval. |
| G1 Feasibility | Clean Windows 11 x64 offline Tauri install, optional sidecar packaging, child cleanup, IPC, encrypted storage/backup and a native Excel read/write feasibility prototype. Measure RAM/size/startup, produce ADRs. Excel is a hard gate, not a later option. |
| G2 Thin slice | Synthetic project → CSV → validated mapping → formula → viewport → audit → offline backup/restore. Rust authority and transactional recovery demonstrated. |
| G3 Finance MVP | Calendar/accounts, trial balance, monthly P&L, linked BS/CF fixture, assumptions, scenarios, variance, CSV/XLSX, lineage, true group consolidation and native offline Excel read/refresh/controlled write-back; finance SME sign-off and fault tests. |
| G4 Pilot hardening | Clean-device offline install/upgrade, security, accessibility, restore, representative performance, runbooks, financial goldens and pilot UAT. |
| G5 General release | Owner accepts pilot issues; signed release, licensing/SBOM, supported matrix and finance/security evidence. |
| G6 Expansion | Select workforce/CapEx, one pack, managed collaboration or advanced Excel features from demand; additional consolidation depth beyond approved V1 scope, regulatory filing content and AI separate releases. |

For context only, illustrative ranges **after G0** for the previously described hypothetical staffed team (not this solo project), assuming validated feasibility: G1 ~4–8 weeks; G2 ~6–10 weeks; G3 ~3–6 additional months; G4/G5 ~2–4 additional months. Work may overlap and slip substantially. The full original vision cannot responsibly be guaranteed in 12 months. Re-estimate after each gate.

## Priorities
P0 correctness, recoverability, offline core. P1 analyst productivity/pilot workflow. P2 optional modules after demand. P3 theoretical breadth. New features require source-to-test evidence and owner.

## Risk register
| ID | Risk | Mitigation/owner | Blocking? |
|---|---|---|---|
| R01 | Wrong financial results | SME goldens, independent checks/provenance / finance | yes |
| R02 | Lost or partial import | authoritative state machine, fault tests, restore / storage | yes |
| R03 | Sensitive data leak | encrypted paths, threat tests, network disabled / security | yes |
| R04 | Offline prerequisites absent | clean VM no-network install/upgrade / release | yes |
| R05 | Windows sidecar/IPC failure | spikes and compatibility contracts / tech lead | for shipped sidecars |
| R06 | Excel incompatibility | documented matrix, no overwrite / integration | for Excel claims |
| R07 | Scope overwhelms quality | release exclusions, approval / product | yes |
| R08 | Local bypass of access control | honest trust boundary / security | for enterprise claims |
| R09 | Dependency redistribution | license review, entitlements, SBOM / release | yes |
| R10 | Unverified performance/size | representative data and measurements / QA | for performance claims |
| R11 | Update corruption or lost key | signatures, backup, recovery drill / IT | yes |
| R12 | Misleading AI/compliance claims | review, no autonomous posting/certification / finance | for affected feature |

Maintain backlog, weekly finance demo/risk review, release tags, decision log, test evidence and named issue owners. Track critical defects, throughput, reconciliation and restore drills, not lines of AI code. Humans approve finance, security, migrations and release.


For this confirmed solo project, elapsed release time remains unknown; record weekly hours, run the feasibility spikes and re-estimate from evidence. Unlimited AI tokens are not a substitute for independent finance/security review. See `13-agent-control-system.md`.
