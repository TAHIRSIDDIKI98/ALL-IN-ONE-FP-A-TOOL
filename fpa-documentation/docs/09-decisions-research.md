# 09 — Decisions, assumptions and research

> **Correction:** [ADR-001](../decisions/ADR-001-v1-lean-local-core.md) is an external AI recommendation, not an approved architecture. All conflicting design choices remain open.

## Historical proposal register (pre-ADR-001; retained for context)
| ID | Proposal / alternative | Required proof |
|---|---|---|
| OLD-PROP-001 | Single-user offline desktop and single Rust authority; alternative local server | owner approval |
| OLD-PROP-002 | Five languages retained; sidecars optional/on demand; Elixir deferred to actual workflow | Windows IPC/startup/memory spikes |
| OLD-PROP-003 | SQLCipher authoritative state + immutable encrypted batches, DuckDB rebuildable projection; alternative one DB | license, temp encryption, crash/restore tests |
| OLD-PROP-004 | Relational/sparse model and formula subset before custom CSF | finance benchmarks |
| OLD-PROP-005 | Tauri MSI/EXE plus offline prerequisites; MSIX later | clean VM/policy |
| OLD-PROP-006 | Native offline Excel add-in required in V1; Rust XLL is preferred candidate subject to API/ABI, trust and write-back spike; .NET is an owner-approved fallback only | test on chosen desktop Office edition/bitness; Excel V1 is mandatory |
| OLD-PROP-007 | Audit tamper-evident only relative to trusted checkpoint; no SOX claim | independent security review |
| OLD-PROP-008 | Three-way scenario conflict resolution, no financial CRDT auto-merge | SME review |
| OLD-PROP-009 | Decimal, debit-positive source, half-even default | SME approval/currency exceptions |

## Corrections to original plan
1. Five runtimes are a tradeoff, not inherent performance wins; gRPC named-pipe support must be proven across selected stacks. Windows OTP releases need VC runtime [S04].
2. Raw memory pointers cannot cross processes; Arrow C Data Interface is in-process [S02]. Mappings/offsets/lifecycle are needed and zero-copy is path-specific.
3. Sparse storage depends on populated values, indexes, metadata and shape. 100 billion potential cells in a few MB and 120 FPS are not universal guarantees.
4. XLSX parsing is not full formula/macro fidelity; POI documents unsupported formulas and streaming limitations [S06].
5. WebView2 often ships on Windows 11 but presence/version must be checked. Default Tauri bootstrapper may require internet; include offline prerequisites [S01, S05]. Measure actual installer size.
6. DPAPI current-user protection does not automatically imply TPM sealing, Hello gating or protection from other same-user programs [S08]. Audit hashes do not make local files immutable or certify SOX.
7. DuckDB in-process write ownership must be explicit [S03]. Encryption/temp settings vary by version [S10]; SQLCipher does not encrypt DuckDB.
8. DirectML is in sustained engineering; ONNX Runtime suggests WinML for new Windows work [S07]. Neither acceleration nor 4 GB total footprint is guaranteed.
9. Elixir actors aren't required for a DAG; simulation performance depends on numerical workload. Separate workflow coordination from Rust computation.
10. Excel XLL and COM/VSTO are different [S09]; VSTO normally adds .NET to stack. Native offline integration needs a separate spike.
11. IFRS/GAAP/XBRL/tax require jurisdiction/version-specific content, rights and expert review. AI cannot establish causal explanations from correlation.

## Questions for owner
1. UAE, single-user and coverage of both Al Ghurair websites are user-confirmed. What is the authorized entity/control perimeter, mainland/free-zone status, accounting standards and currency?
2. Single user is confirmed. Are there organizational identity, separation-of-duties or auditor evidence expectations?
3. Native Excel add-in is mandatory in V1. Office 2021 64-bit is confirmed; what exact edition/build and company add-in policy apply? If Rust XLL proves infeasible, is a sixth implementation language acceptable?
4. Minimum hardware/Windows builds/architecture, dataset sizes, import sources, compliance, accessibility and IT deployment policy?
5. Solo AI builder, Windows machine and unlimited tokens confirmed. What weekly hours, target date, distribution model, external dependency budget and finance/security reviewer access?
6. Day-one must-haves versus roadmap? Are AI/industry packs optional? Commercial or internal distribution?
7. Recovery key ownership/escrow, offline revocation and retention? May portable exports leave the device?
8. Single user for V1; is file exchange or managed LAN needed after V1? Data residency constraints?

## Sources (researched 18 November 2026)
Sources support design facts, not evidence this product works. Documentation may change; validate the pinned version.
- [S01] Microsoft WebView2 offline deployment: https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution
- [S02] Apache Arrow C interface in-process, IPC for cross-process: https://arrow.apache.org/blog/2020/05/03/introducing-arrow-c-data-interface/
- [S03] DuckDB in-process concurrency and alternatives: https://duckdb.org/docs/2.0/connect/concurrency
- [S04] Elixir Windows release and VC++ runtime: https://mix.hexdocs.pm/Mix.Tasks.Release.html
- [S05] Tauri Windows/offline WebView2 installer: https://v2.tauri.app/distribute/windows-installer/
- [S06] Apache POI formula and streaming limits: https://poi.apache.org/components/spreadsheet/formula.html and https://poi.apache.org/components/spreadsheet/
- [S07] ONNX Runtime DirectML/WinML: https://onnxruntime.ai/docs/execution-providers/DirectML-ExecutionProvider.html
- [S08] Microsoft DPAPI scope and same-user applications: https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.dpapidataprotector.scope?view=netframework-4.8.1
- [S09] Excel XLL and Office add-in compatibility: https://learn.microsoft.com/en-us/office/dev/add-ins/excel/make-custom-functions-compatible-with-xll-udf
- [S10] DuckDB encryption: https://duckdb.org/docs/2.0/sql/statements/attach ; temporary-file setting: https://duckdb.org/docs/2.0/configuration/overview
- [S11] SQLite WAL and atomicity boundaries: https://www.sqlite.org/wal.html
