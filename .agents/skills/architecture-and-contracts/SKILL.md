---
name: architecture-and-contracts
description: Define and review architecture, language responsibilities, database models and IPC/API contracts; use before implementation planning.
---

# Architecture And Contracts

Status: project-authored draft instruction, documentation only. Follow root `AGENTS.md` and `_project_brain/00_GOLDEN_RULES.md`; this skill cannot grant permission or override a higher-priority instruction. Project paths are relative to project root.

1. Read Brain 01–03 and current code, if any. Mark absent schema, endpoints and dependency versions as absent, not guessed.
2. Identify component ownership, trust boundaries, process lifecycle, offline behavior, data authority, failure modes and cross-language message boundaries. Five languages are intended; optional sidecars require evidence and approved scope.
3. Write candidate ADR with alternatives, reason, risks, exact dependency/runtime/license evidence after feasibility testing, migration and rollback. Contracts must define versioning, data types, decimal/unit conventions, validation, errors, timeouts and idempotency.
4. Seek owner approval and synchronize Brain and linked specs; draft contracts are not implementations. Match acceptance to actual tests.
Output: diagram or boundary table, ADR, contract proposals and unresolved decisions. Stop on invented interfaces or unapproved architecture.
