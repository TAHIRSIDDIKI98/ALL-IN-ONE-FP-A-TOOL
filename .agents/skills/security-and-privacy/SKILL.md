---
name: security-and-privacy
description: Threat-model local financial data, security, privacy and audit controls; use for sensitive workflows, imports or deployment.
---

# Security And Privacy

Status: project-authored draft instruction, documentation only. Follow root `AGENTS.md` and `_project_brain/00_GOLDEN_RULES.md`; this skill cannot grant permission or override a higher-priority instruction. Project paths are relative to project root.

1. Classify assets and users; map workstation, application, Excel, file import, backups, AI and outside sources across trust boundaries. Explicitly include same-user malware and privileged administrator threats.
2. Describe plausible misuse, likelihood/impact assumptions, mitigations and residual risks; use platform cryptography and key management, not custom crypto. Evaluate data leakage in logs, caches, swap, exports and support bundles.
3. Require explicit corporate data authorization, redaction and retention policy; local append-only/hash chains do not assure immutability from a privileged operator. Single-user UI is not enterprise separation of duties.
4. Define negative tests, least privilege, patch and incident response plan; separately record specialist review unavailable, requested or completed.
Output: asset/threat/control matrix, evidence and residual-risk owner. Stop on unsanctioned data use or misleading security guarantees.
