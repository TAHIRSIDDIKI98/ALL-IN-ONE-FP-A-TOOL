# 04 — Offline, security, privacy and governance

> **Correction:** [ADR-001](../decisions/ADR-001-v1-lean-local-core.md) is an external AI recommendation, not an approved architecture. All conflicting design choices remain open.

## Offline contract
On a clean supported Windows 11 x64 machine with Ethernet disconnected and Wi-Fi/Bluetooth disabled (or equivalent verified air gap), installer, prerequisites, launch, create, import, edit/recalculate, export, backup, restore and upgrade work indefinitely without account, remote clock/license check, telemetry, update check, CDN, model download or server. Transfer release artifacts and optional model packs via approved media. Disable network by default; user explicitly enables future integrations. ERP access needs its endpoint/driver and connectivity; not available in a physical air gap. Excel integration needs installed supported desktop Excel/add-in but is not necessary for core app.

## Threat model
Assets: payroll, source records, formulas, snapshots, exports, recovery keys. Threats: stolen disk/device, unauthorized OS users, malicious imports, same-user malware, admins, supply chain, plugins and network peer. Goal: protect data at rest against offline disk theft using encrypted artifacts/protected keys and limit ordinary user exposure using app authorization and Windows ACLs. Non-goals: guaranteed secrecy against malware as authorized user, administrators or live memory inspection; equating solo local controls with independently enforced enterprise segregation.

## Encryption and keys
- Generate random per-project data keys via OS CSPRNG; vetted authenticated encryption, unique nonces, versioned algorithms. Encrypt SQLCipher DB, DuckDB projection/WAL/spill as verified, staging, backups, artifacts and portable exports. Paging/hibernation and user-created exports require device controls (e.g., BitLocker); don't promise no plaintext anywhere. Secure directory/process resources with ACLs.
- Wrap project key using current-user DPAPI for convenient same-user access. DPAPI is not automatically TPM-sealed, Windows Hello-gated or safe from other programs in the same user context. Optional Hello/TPM-backed protection is a separate reviewed mechanism and recovery policy.
- Independent user-chosen export/recovery passphrase or enterprise recovery key, vetted memory-hard KDF, salt and parameters. Never store secrets in archive/log. Key loss is unrecoverable without another wrap/backup. Document escrow where allowed, restore drill, rotation, migration, account deletion, lockout and revocation; keep encrypted backups and recovery material separately.
- Rewrapping is not equivalent to revoking old keys: re-encrypt where necessary. Cannot revoke previously exported copies.

## Audit, identity and privacy
Event: unique ID, per-project sequence, local Windows principal/session with caveats, type, target/revision, timestamp/timezone, reason, outcome, content hashes, previous digest, version and canonical payload. Append in same SQLite transaction as mutation. Minimize sensitive data, encrypt and define retention/access. A hash chain only detects changes relative to an independently retained/trusted signed checkpoint; it doesn't stop privileged local rewriting or rollback. Optional external anchoring requires an explicit trusted process. Never call local history immutable or claim SOX compliance without controls and independent review.

V1 uses OS user/project access; UI is not the security boundary. Later row/cell permissions apply before query, aggregates, lineage, search, exports, caches and AI, with no-leak tests/fail closed. A user with the project key can access outside UI; real multi-user separation needs trusted service, per-user encrypted subsets or equivalent, plus controls. Offline revocation and identity spoofing limitations must be stated. SOX needs control ownership, evidence, segregation, change management and access reviews, not RBAC alone.

## Untrusted files and updates
CSV export: sanitize spreadsheet-formula prefixes under explicit policy and warn if presentation changes. Reject path traversal, zip bombs, oversized/nested files, malformed encodings, unsafe XML/XXE and links. Never auto-execute macros or fetch external workbook links. Validate Arrow buffers; quota resources. No arbitrary code in formula DSL. No unapproved outbound logging.

Produce dependency inventory, licenses, notices, SBOM and provenance; check SQLCipher edition, drivers, Office/SAP redistribution and AI model rights. Sign binaries/installers and verify signatures/hashes offline with provisioned trust keys; address expiry, release-time timestamping, revocation constraints, rotation and lost-key recovery. Verify update, back up, test migration/rollback (or restore pre-upgrade backup). Bundle offline WebView2 and VC++ prerequisites where needed and account for architecture. Measure real sizes. Air-gapped WebView2/OS needs an offline security-update process.
