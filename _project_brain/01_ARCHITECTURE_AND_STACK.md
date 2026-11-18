# 01 — Architecture and stack

**Status:** Architecture under discussion; no technical stack, dependency versions, physical schema or API implementation has been approved or verified. Updated 18 November 2026. The user clarified that the prior long stack message was another AI's **recommendation**, not owner decisions. See `05_DECISION_LOG.md`.

## User-confirmed constraints
- All-industry FP&A with first UAE focus, businesses represented by both Al Ghurair websites as user-directed; legal/control perimeter remains unverified.
- Windows 11 x64, single user, fully offline; native Office 2021 x64 Excel add-in and true group consolidation required in V1.
- User named Rust, TypeScript, Java, Go and Elixir for the project. In a prior direct selection the user chose to use each language **when needed**, favoring a balance of simplicity and long-term flexibility; this is not selection of exact components.
- A separate AI-generated UI prototype prompt may use React + Vite + Tailwind; that does not decide the production desktop stack or authorize changes to the application code.
- Prior alleged Ryzen/RAM information came in the same external AI recommendation and is **unverified**; user hardware specifications are unknown pending direct confirmation.

## Research proposals — all unapproved
The historical `../fpa-documentation/decisions/ADR-001-v1-lean-local-core.md` records a third-party recommendation for Rust/TypeScript/Tauri/React, SQLCipher, native XLL/named pipes, optional later Go/Java/Elixir, specific numerical scales, recovery mechanism and performance goals. **None of these are owner-approved architecture, security design, thresholds or authorization to start spikes.** Rust C-ABI XLL and any C/C++ fallback require explicit decision, feasibility, security and license review. DuckDB and other alternatives remain under consideration.

Project fundamentals: one consistent financial authority and ACID mutation/audit/idempotency boundary; exact decimal or scaled-integer calculation; secure offline operation; preserved imports and auditability; financial-policy review; Office compatibility. Excel's binary numbers may not represent fractional decimals exactly, and SQLite INTEGER is 64-bit if SQLite is chosen. Do not promote a proposed choice without owner approval.

## Implementation truth
No application code, schema, API, lockfile, binaries, Excel add-in, certificate, Windows test, finance validation, or benchmark exists. Exact versions and libraries are unselected. Earlier UI/stack sketches are drafts, not an implemented or approved repository. Separate UI prototype created by another AI must use fictional data, explicitly identify its prototype state and never claim backend implementation, Excel, financial integrity or compliance.
