---
name: release-and-supply-chain
description: Govern dependency selection, licenses, SBOMs, offline Windows release, signing and rollback; use before adopting packages or releasing.
---

# Release And Supply Chain

Status: project-authored draft instruction, documentation only. Follow root `AGENTS.md` and `_project_brain/00_GOLDEN_RULES.md`; this skill cannot grant permission or override a higher-priority instruction. Project paths are relative to project root.

1. Inventory direct/transitive dependencies and runtime, package sources, license and redistribution obligations; pin only after feasibility and owner approval. Separate research candidates from approved dependencies.
2. Record verifiable source, version, checksum, upstream advisories, compiler/build environment, SBOM and build provenance. Inspect binaries and tools; no unreviewed install scripts or secrets.
3. Plan reproducible builds where feasible, code signing and trust policy, offline prerequisite installation, update validation, migration/rollback and restored backups. Do not assume certificate availability.
4. Require documented functional, financial, security, privacy, Windows/Excel and offline gates with actual evidence; any unavailable independent reviewer remains an explicit blocker or owner-accepted risk, not a false sign-off.
Output: release checklist, provenance/license inventory and outstanding gates. Stop on unverified security or redistribution claims.
