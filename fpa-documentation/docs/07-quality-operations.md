# 07 — Test strategy, performance and Windows operations

## Test pyramid and release evidence
- Unit: decimal/rounding, date edges, hierarchy, parser/types, graph, authorization, audit canonicalization, manifest.
- Property/metamorphic: full vs incremental calculation, sum reconciliation, hierarchy invariants, reversal, replay, random valid and malformed cases; independently computed oracles.
- Finance goldens: openings/closings, negative/unmapped, accrual, balance/cash bridge and cutoff; source-to-export comparison; SME independently verifies expected results.
- Integration: adapter → stage → transaction → projection → UI; conflicts, contracts, one writer, cancellation; kill/restart sidecars; no handle/path leak.
- Fault injection: terminate before/after ingest/commit/rename/projection; disk full, power loss proxy, missing/corrupt artifact, wrong key, access failure and interrupted upgrade. No uncommitted visibility; acknowledged commits recover or show explicit blocking corruption.
- Security: ACL/named-pipe impersonation, malformed files/zip bomb, XML, CSV formula injection, sensitive logs/crash dumps, unauthorized aggregate/lineage/export, no default network; independent threat review and periodic penetration test.
- Windows E2E: clean VM, network disabled before install, prerequisites absent/present, install/update/uninstall, reopen, restore new profile, WebView2 versions, high DPI, keyboard/screen reader. Record build/OS/CPU/RAM/SSD. x64 only until ARM64 certified.
- Accessibility: keyboard navigation, focus, contrast, names, grid semantics, screen-reader fallback, zoom/DPI; WCAG 2.2 AA is a design goal and applicable criteria require verification, not automatic certification.

## Benchmark protocol (proposal, not measurement)
Reference: Windows 11 x64, 16 GB RAM, 4–8 modern CPU cores, SSD, no discrete GPU; confirm supported OS builds. Small synthetic model: 24 months, 200 accounts, 10 cost centers, 2 scenarios; 1M transaction CSV with realistic widths/sparsity. Record 30 warm iterations, p50/p95 and peak process-tree private working set, cold start, device, power settings and versions. Proposed feasibility goals: p95 viewport update <250 ms for 100×30 visible grid; p95 driver recalc <2 s on described model; cold launch <10 s; establish import/restore baselines then agree targets. Track correctness/errors as well as speed. Heavy imports off UI thread with progress/cancel and bounded CPU/temp/memory. No 10M rendered cells at 120 FPS, <250 MB idle, or simulation-in-seconds guarantee without tests.

## Installer and resource strategy
Prefer Tauri-supported MSI/EXE first; MSIX needs packaging/permissions spike. Bundle full offline WebView2 installer if needed; bootstrapper alone downloads. Verify licensing and VC runtime for OTP/native deps. Sidecars on demand; resource caps, process supervision, graceful shutdown/cleanup; Job Object nesting/breakaway must be Windows-tested. Don't guarantee memory reduction from forced GC on minimize; measure. Package by architecture; measure sizes after signing. Enforce signing policy in release; don't invent dev signatures.

## Operations and support
Opt-in redacted diagnostic bundle: versions, codes, feature config, timings and stack traces; no model data, keys or raw import by default. Errors include support code and recovery action. Bundle help offline. Triage → preserve workspace/backup → check key/disk/schema → read-only integrity check → restore copy → escalate. No destructive repair without approval. Document encrypted backup rotation, restore drills, recovery key ownership and upgrade. Retain incident evidence securely, consult counsel on notifications, issue signed offline patches. Uninstall never deletes projects without explicit confirmation.

## Definition of done
Linked tests green in correct environment, independent review, SME approval if needed, no open release-blocking defects, offline/security/restore tests passed, unsupported cases documented, evidence stored, requirements mapped, status/changelog updated, migration/rollback tested. Tests not run are **not passed**.
