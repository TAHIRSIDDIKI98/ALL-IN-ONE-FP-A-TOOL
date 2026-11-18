---
name: quality-and-assurance
description: Build traceable acceptance tests, independently calculated finance oracles and negative/failure cases; use for verification and release readiness.
---

# Quality And Assurance

Status: project-authored draft instruction, documentation only. Follow root `AGENTS.md` and `_project_brain/00_GOLDEN_RULES.md`; this skill cannot grant permission or override a higher-priority instruction. Project paths are relative to project root.

1. Link requirement and approved scope to fixture, expected result, test case, environment, actual result, evidence and reviewer. Unknown and not-run are distinct from pass.
2. For finance establish independently reviewed synthetic oracle, decimal precision and policy. Test conservation, balanced journals, statements, IC, FX, reversals, stale inputs and rounding boundaries.
3. Add unit, property, differential, integration and real Windows/Excel acceptance cases as appropriate, plus concurrency, filesystem failure, backup/restore and offline behavior.
4. Document commands, exact versions and outputs; do not modify expectations or remove tests to hide failures. Human/finance review cannot be simulated by the author.
Output: traceability matrix and test report with unrun items and defects. Stop at unverified release claim.
