# PRJ-DIST — Windows 11 Packaging, Win32 Job Objects, DPAPI & Air-Gap QA

**Sub-Project ID:** `PRJ-DIST` · **Target Artifact:** `atlas-fpa-omni.msi` (WiX Toolset v4 Per-User Installer) · **Phases Unlocked:** `P7` · **Status:** Contract-specified (`not yet built in Linux UI preview`)

---

## 1. Identity & Ownership Boundary

`PRJ-DIST` governs the **single-user offline Windows 11 installation bundle, process supervision lifecycle, OS key-protection envelope, and air-gap acceptance testing** across all packaged binaries (`fpa-core.exe`, `fpa-io.exe`, `fpa-flow`, `fpa-docs.exe`, `fpa-xll.xll`, and Tauri WebView2 UI).

---

## 2. Process Supervision, DPAPI & Recovery Contract

- **Win32 Job Objects**: Parent launcher places all child processes (`fpa-io`, `fpa-flow`, `fpa-docs`) inside a `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` handle so closing Atlas FP&A guarantees zero orphaned background workers holding SQLCipher or port locks.
- **DPAPI Key Envelope & Portability Caveat**: Primary machine unlock wraps the SQLCipher vault key with Windows `CryptProtectData` (DPAPI `CurrentUser`). Because DPAPI binds to the local Windows profile (not automatically TPM-sealed across devices), `PRJ-DIST` mandates a verified **user-held recovery passphrase / encrypted backup export (`GAP-010`)** tested on a second clean Windows 11 VM.
- **Per-User Standard Install**: Installs cleanly under `%LOCALAPPDATA%\AtlasFPA` without requiring elevated local Administrator privileges after WebView2 presence check.

---

## 3. Owned Invariants & Sign-Off Gates

`PRJ-DIST` enforces: `I21`, `I24`, `I32`, `I36`, `I40`.
Requires documented evidence before v1.0 release:
- Offline Windows 11 Enterprise VM boot with NIC disabled (`0` failed requests, `0` Windows Firewall prompts).
- Second-device encrypted backup restore drill (`GAP-010`).
- Signed Group Finance (`CONS-001`–`009`), UAE Tax (`U-02`/`U-03`), and Security sign-offs (`GAP-001`–`006`).

---

## 4. Phase Exit Gate & Verification Command

- **Phase P7 Gate**: `msiexec /i atlas-fpa-omni.msi /qn && fpa-core.exe --verify-all-invariants --parity-vectors atlas-fpa-v4.0-parity-vectors.json`
