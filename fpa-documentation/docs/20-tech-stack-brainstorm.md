# 20 — Tech-stack brainstorming: decisions before implementation

**Status:** Brainstorming discussion; [ADR-001](../decisions/ADR-001-v1-lean-local-core.md) was another AI's unapproved recommendation, not an owner decision · **Date:** 18 November 2026 · **Scope:** documentation and research only. No product code, build, database schema, contract or Windows test exists.

## 1. What the stack must solve

Confirmed: Windows 11 x64, single user, completely offline install and use, native Office 2021 64-bit Excel add-in in V1, true group consolidation in V1, all-industry platform with both user-identified Al Ghurair portfolios in initial business coverage, and a solo AI-assisted builder. The user named Java, Elixir, Go, Rust and TypeScript; whether all five must ship in V1 needs confirmation. Exact scale, hardware, Office edition/build and company IT policies remain unknown.

**Trade-off:** The user wants a powerful all-industry platform; it must remain possible to implement, verify, package and maintain. This is not permission to remove native Excel or true consolidation from V1. Detailed sector depth and accounting acceptance need explicit owner agreement.

## 2. Three candidate overall shapes

| Shape | Concept | Strengths | Costs / risks | Appropriate when |
|---|---|---|---|---|
| **A. Lean local core** — working recommendation | TypeScript UI + Tauri desktop + Rust authority; one encrypted transactional store; native Excel bridge. Add other languages only for capabilities that justify them. | Fewest runtimes, simplest crash recovery/packaging and easiest for a solo builder; preserves room for other languages. | Rust/Excel ABI and encrypted SQLite Windows build need proof; deferred language deployment may conflict with the owner's intent. | User accepts all five as available project languages, not five mandatory shipped services. |
| **B. Five-language modular V1** | Rust core, TS UI, plus meaningful Java, Go and Elixir components shipped offline; each has a defined contract and isolated duty. | All five languages contribute in V1; runtime boundaries may enable specialized adapters. | More runtime packaging, IPC, vulnerabilities, tests and debugging; Elixir/Java distributions and support burden; artificial role splitting is wasteful. | Owner explicitly requires all five in V1 and accepts scope/cost. |
| **C. Windows-native alternative** | Compare a Microsoft-oriented desktop/add-in host, with Rust or another approved core. A .NET/C# and Excel-DNA option would add a language/runtime outside the five. | Mature Windows ecosystem may simplify some add-in/UI development. | Conflicts with the existing five-language rule unless owner approves an ADR; extra runtime/trust and Excel compatibility must be tested, not assumed. | Only with explicit permission to add a language/runtime and evidence that it solves a real problem. |

These are designs to compare, not pre-approved dependencies. A desktop application is not automatically offline simply because it runs locally. We can use a **modular monolith in one Rust authority** internally without building distributed microservices.

## 3. Candidate stack by layer

| Layer | Working proposal / alternatives | Decision and failure modes |
|---|---|---|
| UI | TypeScript + React; other TS frameworks possible | React is familiar, not mandatory. Choose after evaluating keyboard-heavy grids, accessibility, large datasets, licensing and maintenance. UI must not recalculate authoritative money using JavaScript `number`. |
| Desktop shell | Tauri + WebView2 vs Electron vs Windows-native UI | Tauri pairs naturally with Rust and can bundle an offline WebView2 installer; Electron bundles its own browser/runtime but increases distribution and patch burden. Compare on the actual Windows machine; no size/performance promise. [S1] |
| Domain and finance core | Rust domain modules vs Java core if owner changes candidate | Rust is a **proposed** sole authoritative writer/calculator. Keeping finance rules in one authoritative core avoids five implementations disagreeing. A well-tested model and accounting policy matter more than language speed alone. |
| Amounts and rates | Fixed-scale scaled integer or decimal library; financial rates need explicit scale | Choose representable range, intermediate precision, rounding/tie-breaking, overflow and currency/unit policy. SQLite INTEGER is signed 64-bit; an i128 in Rust cannot simply fit into it. Text/blob or another representation needs comparison/indexing and migration design. Store and exchange canonical exact representations; Excel binary float is a separate boundary. |
| Transaction database | SQLCipher/SQLite candidate vs other independently assessed embedded encrypted store | ACID boundary includes authoritative change, model revision, idempotency result and audit. Standard SQLite has no built-in whole-database encryption by default; SQLCipher has distinct edition/license/build considerations. Test runtime encryption, WAL, backups and actual bundled SQLite version/fixes. [S2–S4] |
| Analytics | Begin with measured SQL queries; add encrypted DuckDB as rebuildable projection only if justified | DuckDB can speed analytical queries but introduces another engine, encrypted files/temp paths, stale projection and lifecycle management. Its encrypted database, WAL and temporary-file behavior is documented for supported configurations; verify exact version/settings, bundled extensions and leakage paths. It is never a second ledger of record. [S5] |
| Excel | Native 64-bit XLL candidate; compare Rust C-ABI approach with documented Microsoft C/C++ XLL approach | Microsoft documents C/C++ for XLLs; compatibility of a Rust C-ABI implementation and toolchain is **not guaranteed** and needs a spike. C/C++ or .NET bridges would require explicit extra-language approval. A file exporter is not the required native add-in. [S6–S7] |
| IPC | Framed local child-process IPC; Excel bridge candidate named pipe | Child stdio and separate Excel-host connection are different problems. ACL, identity, no remote clients, framing, bounded messages, timeouts, lifecycle and same-user malware require design/test; no arbitrary localhost service by default. |
| File import/export | Start with strict CSV and explicitly scoped spreadsheet support; Java/Go adapter if justified | Preserve source, validate, reconcile and retain row-level lineage; no VBA execution. Excel file creation is not Excel add-in support. Complex workbook round-trip fidelity needs explicit scope and tests. |
| Local AI | Optional model/runtime chosen by later approved feature scope; CPU baseline vs accelerators | Never required to run core finance; local inference is not automatically offline-installable. Microsoft notes Foundry Local downloads models/providers; pre-provisioned artifacts and tests are needed. AI suggests; it does not approve or post. [S8] |
| Build and delivery | Windows x64 native build, offline installer, artifact/lockfile and license inventory | Test disconnected first install, prerequisites, upgrades, signed installer, add-in policy, backup and restore; no claim that Windows/Excel validation has occurred. |

## 4. The five languages: possible meaningful jobs, not obligations

| Language | Plausible role | Include only if… | V1 commitment |
|---|---|---|---|
| **Rust** | Finance calculations, authority, local transactions, storage and native integration candidate. | ABI, Windows build, libraries and numerical policy pass feasibility tests. | Proposed, not selected. |
| **TypeScript** | Desktop UI, interactions, non-authoritative display logic. | UI remains responsive and accessible with realistic workloads. | Proposed, not selected. |
| **Go** | Sandboxed/on-demand import, data-validation or external-format adapter. | Clear workload that Rust cannot handle more simply; no direct authoritative DB access. | Not yet decided. |
| **Java** | On-demand document/workbook adapter or enterprise-format integration. | A format needs mature Java tooling, with offline minimal JRE packaging and fidelity verified. | Not yet decided. |
| **Elixir** | Supervision, long-running batch workflow or queue coordination. | Real need beyond Rust task management and Windows runtime/recovery proven. | Not yet decided. |

If all five must ship, define what each actually does, required runtime, failure isolation, offline installer and acceptance tests before selecting. Do not create dummy components simply to satisfy a count. Rust owns data only within proposal A/B; final authority is an owner decision.

## 5. Native Excel is the key architectural risk

The add-in and desktop can start in either order. We need to decide who starts the core, who owns workspace locks, whether simultaneous workbooks/Excel processes are supported and what happens after a crash. Proposed behavior: worksheet functions **read only**, while a separate explicit user-confirmed command previews and atomically commits write-back through the core; retries use a persisted idempotency key. Excel's numeric interface and stored workbook caches can lose precision or show old/sensitive values. Choose exact text vs numerical result policy by use case, and visibly expose revision/staleness. Test Office 2021 x64 with organization trust settings and network unplugged. A local ACL cannot guarantee protection from same-user malware.

Candidate feasibility comparison (not executed):
1. Rust-to-Excel C ABI/XLL: simple read-only synthetic function, type/string allocation/lifetime, register/unregister, threading/recalculation and errors.
2. A supported documented C/C++ XLL route: compare maintainability, compatibility and user approval for a sixth language before adoption.
3. Explicit write command, authentication, selection mapping and atomic retry/recovery across actual Excel/core restarts.
4. Package/sign/trust test under the target Office build and IT rules. Fail/stop rather than lowering trust settings broadly.

## 6. Integrity and offline boundaries

- **Authoritative state:** one transactional authority for balances/assumptions, version, idempotency and audit. Sidecar errors must not partially mutate it. Do not treat DuckDB + SQLite + files as one transaction.
- **Numbers:** financial calculations use decimal or scaled integers with explicit units, range and rounding. Define Excel conversion/precision failure and prevent JS/Excel floating-point values from silently becoming authority.
- **Audit:** append-only in the application transaction; hashes/checkpoints can reveal changes but are not immutable against a privileged local user. No SOX/security-certification claims.
- **Encryption/recovery:** specify key protection and user recovery on another device; cover DB, source artifacts, projection, backups and temp files; document Excel cache, OS paging and same-user/admin residual risks. Test lockout, corrupted backup and disk full.
- **Offline:** models, libraries, WebView2, Excel and all prerequisites needed for the promised functions must already be present or packaged with permission. No mandatory cloud license server, remote activation, CDN, account, telemetry or network call.
- **Financial policy:** group control/ownership, eliminations, FX, NCI and accounting acceptance require authorized input; websites do not establish legal consolidation perimeter.

## 7. Evidence-first decision plan — future spikes require separate approval

These are proposed *experiments*, not Task #1 or permission to implement. Do not start until owner authorizes an experiment and the appropriate Brain/spec gates.

| Spike | Synthetic experiment on user's actual Windows device | Pass evidence to collect | If it fails |
|---|---|---|---|
| S-01 Offline desktop | Install from a local bundle onto a disconnected test machine with missing/old WebView2. | Installer log, prerequisite versions, first launch with network disabled. | Adjust prerequisites or compare alternative shell. |
| S-02 Excel XLL | Read-only synthetic native XLL + separate explicit command on Office 2021 x64; exercise Excel-first/core-first and crashes. | Exact Office build, ABI/toolchain, trust, thread/recalc, precision and command results. | Compare documented C/C++ or other permitted bridge after approval; no silent downgrade to export-only. |
| S-03 Financial exactness | Independent manual fixture for three statements and balanced group consolidation, decimal bounds and negative cases. | Inputs, expected result, policy, actual result and finance review. | Revise finance spec or numeric choice; don't proceed on incorrect outputs. |
| S-04 Storage/restore | Encrypted transaction + audit/idempotency with forced crash, duplicate request, backup and restore to another Windows profile. | Actual bundled versions/patches, encrypted artifacts/temp/WAL checks and failure results. | Fix or reconsider storage/key strategy. |
| S-05 Five-runtime distribution | Only if owner requires all five: package meaningful sidecars offline and test failure/shutdown/restart. | Version/license inventory, installation size, process behavior and support burden. | Reduce mandatory runtime count only with owner agreement. |
| S-06 Realistic performance | Synthetic representative entity/account/period/scenario volumes and common report/Excel actions. | Hardware specs, reproducible dataset, timings, memory, cold/warm, and subjective usability. | Optimize after measurement; consider DuckDB only if needed. |

Finance/signing/security reviewers and exact acceptance thresholds are not assumed to be available. Record their availability and open risks rather than invent approvals. Models, schemas, test thresholds, runtimes and exact dependency pins remain unselected.

## 8. Questions for the owner
1. **Five languages:** must Java, Elixir, Go, Rust and TypeScript all ship with useful functions in V1, or may Java/Go/Elixir be added later where justified?
2. **Hardware and scale:** Windows PC CPU, RAM, GPU, storage; approximate legal-entity count, monthly history and typical rows per import, if known. If unknown, use explicit provisional benchmark ranges and replace with real numbers later.
3. **Primary trade-off:** given equal financial/security/Excel requirements, prioritize fastest safe pilot, maximum long-term flexibility or mandated use of all five from day one?
4. **Office/IT:** exact Office edition/build, company policy on signed XLLs and approval to use a corporate Windows test machine when available.
5. **Data security:** is moving a backup to a replacement PC essential, and who will hold a recovery secret? No architecture can recover encrypted data without a viable key-recovery decision.

## 9. Source register (research 18 November 2026)
- S1: [Tauri Windows installer and WebView2 offline/fixed options](https://v2.tauri.app/distribute/windows-installer/). Vendor-reported sizes are approximate and version-dependent; test offline installation.
- S2: [SQLite WAL and WAL-reset bug](https://www.sqlite.org/wal.html). Check the actually linked SQLite source/patch, including encrypted fork, rather than relying on a wrapper's version.
- S3: [SQLite backup API](https://www.sqlite.org/backup.html). A raw live file copy is not automatically a consistent backup.
- S4: [SQLCipher Community edition license](https://www.zetetic.net/sqlcipher/community/). Community/commercial editions have different obligations; assess dependencies and no-online-activation needs.
- S5: [DuckDB encryption discussion](https://duckdb.org/2025/11/19/encryption-in-duckdb); [ATTACH encryption](https://duckdb.org/docs/1.4/sql/statements/attach). Verify version/configuration and local extension availability.
- S6: [Microsoft Excel C API 64-bit support](https://learn.microsoft.com/en-us/office/client-developer/excel/what-s-new-in-the-c-api-for-excel).
- S7: [Microsoft XLL guidance](https://learn.microsoft.com/en-us/office/dev/add-ins/excel/make-custom-functions-compatible-with-xll-udf). Microsoft describes C/C++ XLLs; a Rust implementation remains an unverified ABI experiment.
- S8: [Foundry Local architecture](https://learn.microsoft.com/en-us/azure/foundry-local/concepts/foundry-local-architecture). Downloads are described for models/providers; offline provisioning and hardware behavior need validation.
- Related project sources: [Architecture](02-architecture.md), [Excel](11-uae-excel-v1.md), [Engineering decisions](18-engineering-and-finance-decisions.md), [Consolidation](19-consolidation-scope.md), [Skills](../skills/README.md).
