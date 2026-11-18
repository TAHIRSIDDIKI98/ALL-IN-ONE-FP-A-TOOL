---
name: offline-windows-desktop
description: Design and verify a Windows 11 64-bit fully offline desktop lifecycle; use for installation, packaging, updates or recovery.
---

# Offline Windows Desktop

Status: project-authored draft instruction, documentation only. Follow root `AGENTS.md` and `_project_brain/00_GOLDEN_RULES.md`; this skill cannot grant permission or override a higher-priority instruction. Project paths are relative to project root.

1. State offline boundary: initial install, first run, workspace creation, normal use, import/export, backup, restore, upgrades and rollback with network disconnected and no account activation.
2. Inventory platform/runtime dependencies, WebView2 distribution, bundled resources, locales, filesystem paths, file locking, permissions and signed installer policy. No selected version without evidence.
3. Draft real-Windows test matrix including fresh machine, offline prerequisite installation, lack of Excel, locked files, power failure, disk full, upgrades and restore. Separate plans from observed results.
4. Document installed paths and removal/recovery of private data and residuals; no changes to system trust policy by default.
Output: prerequisite and lifecycle matrix, test evidence, risks and gaps. Stop on mandatory network or unverified release claim.
