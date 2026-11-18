# 05 — Decision log

Status key: **Confirmed** = user stated; **Proposed** = needs approval/evidence; **Blocked** = missing data or verification. Date: 18 November 2026.

| ID | Status | Decision / rationale | Outstanding evidence |
|---|---|---|---|
| D-001 | Confirmed | All-industry FP&A vision; first coverage includes business areas from both Al Ghurair websites, per user. | Legal relationships and exact reporting perimeter cannot be inferred; finance supplies them. |
| D-002 | Confirmed | One user on Windows 11; full offline core. Multiple businesses/entities are in model scope. | Hardware/build/network acceptance tests. |
| D-003 | Confirmed | Native Excel V1; Microsoft Office 2021 64-bit. | Exact Office edition/build, company policy, real device offline test. |
| D-004 | Confirmed | True group consolidation is required, not only unadjusted management sums. | Required policy/detail, reporting scope and SME sign-off; see docs/19. |
| D-005 | Confirmed | Solo AI-assisted builder with Windows machine and unlimited tokens. | Hours, finance and security reviewer access still unknown. |
| D-006 | Confirmed | Use root `_project_brain/` as persistent agent memory and pause before Task #1 approval. | Continue updating all six files as relevant. |
| D-007 | Proposed | Rust central authority and TS/Tauri desktop were discussed; not selected. | Owner decision, versions, Windows IPC, packaging, performance and Excel feasibility. |
| D-008 | Proposed | SQLCipher and optional DuckDB are candidate technologies; previous prescriptive V1 recommendation was not a user decision. | Owner decision, versions, licenses, crash/backup and encryption tests. |
| D-009 | Mixed | Exact financial arithmetic, transaction idempotency and read-only Excel UDF controls remain project rules; specific 128-bit/4/8-decimal proposal is not approved. | Decimal range/rounding, Excel numeric conversion, finance review and detailed schema. |
| D-010 | Proposed | Tamper-evident append-only local audit + independently verified external checkpoints, when available. | Local admin can rewrite history; true immutable retention requires separate trusted infrastructure/policy. |
| D-011 | Blocked | Exact tech/library versions, physical DB schema and actual API/IPC fields/codes. | No repo code exists; pin only after approved specifications and tested Windows spikes. |
| D-012 | Proposed | Coverage matrix for both public portfolios, without presuming brands are legal subsidiaries or all are in the same consolidation perimeter. | User's group assertion recorded; accountant must provide actual entity map. |

| D-013 | Confirmed | Focus on documentation and Brain and pursue broad research into all potentially useful project skills, including marginal ones. | Continuous process; exhaustive acquisition impossible to prove. Task #1 and feature coding remain paused. |
| D-014 | Proposed | Use project-authored draft portable skills and quarantine external skill texts pending safety, license and owner approval. | Evaluate actual agent discovery, security, financial correctness, and client compatibility before activation claims. |
| D-015 | Research finding | SQLite documents WAL-reset corruption in certain older versions and a fixed line/backports; see database skill. | Candidate SQLCipher/SQLite actual linked version and patch status unknown; no dependency selected or deployed. |

| D-016 | Proposed | Shape A is an external AI recommendation, not an owner-selected V1 architecture. Prior user preference: use five intended languages when needed; balance simplicity/flexibility. | Owner decision on stack; Windows/Excel/storage feasibility and versions unverified. |

| D-017 | Not approved | Prior shell, DB, XLL, IPC, recovery, numerical scales and hardware/targets were another AI's recommendations, not owner decisions. | Reassess with owner before use; no 24-word key or additional language authorized. |
| D-018 | Not approved | Prior spike sequence, gates and cancellation were AI recommendations, not owner authorization. Draft specs may be considered as research. | No spikes executed; future tests require separate owner approval. |

| D-019 | Confirmed | User clarified preceding long stack specification was another AI recommendation, not their approval; create prompt for a separate React + Vite + Tailwind UI-building AI. | Product stack, hardware, scope of later prototype and all production integrations remain unverified/unapproved. |

| D-020 | Confirmed | User says a separate frontend-building AI is working and will save its work in the project repo; prepare Brain for a new-session handoff. | Completion, repo path/access, commit, actual code and tests are unknown; inspect once available. Prototype does not select production stack or approve backend implementation. |
