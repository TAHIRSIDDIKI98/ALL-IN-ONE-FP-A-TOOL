---
name: database-and-recovery
description: Specify transactional storage, SQLite WAL and database backup, encryption, crash recovery and migration; use for data persistence.
---

# Database And Recovery

Status: project-authored draft instruction, documentation only. Follow root `AGENTS.md` and `_project_brain/00_GOLDEN_RULES.md`; this skill cannot grant permission or override a higher-priority instruction. Project paths are relative to project root.

1. Map the authoritative database, atomic transaction boundary and non-atomic artifacts/projections. Record idempotency, audit, schema revision and recovery semantics together.
2. For candidate SQLite WAL document attached-database limits, `-wal`/`-shm` sidecars, checkpoint, locking and supported online backup. Do not assume a file copy of a live DB is consistent.
3. SQLite reports a rare WAL-reset corruption bug in 3.7.0 through 3.51.2, fixed in 3.51.3 and later with backports 3.44.6 and 3.50.7: https://www.sqlite.org/wal.html#walresetbug . Verify the actual linked runtime/fork contains the fix before approval; encrypted forks may lag. This is a research constraint, not a selected pin.
4. Design failure-injection tests for crash at each commit/artifact boundary, concurrent connections, disk full, backup/restore, encryption key loss and migration rollback. No test is passed until run.
Output: transaction/recovery sequence, test cases and exact runtime evidence. Stop on mixed uncoordinated atomicity claims.
