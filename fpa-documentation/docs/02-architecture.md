# 02 — Architecture and technical contracts

> **Correction:** [ADR-001](../decisions/ADR-001-v1-lean-local-core.md) is an external AI recommendation, not an approved architecture. All conflicting design choices remain open.

## Proposed architecture (approval pending)
```text
[TypeScript/React in Tauri WebView2]   [Native Excel add-in: V1; mechanism spike]
              | allowlisted Tauri commands; batched viewport requests
[Rust host + project authority + calculation + storage]
       | typed, authenticated local sidecar protocol
       +-- [Go adapter: CSV staging/validation; optional/on demand]
       +-- [Java adapter: controlled XLSX export; optional/on demand]
       +-- [Elixir OTP: later workflow coordination; optional/on demand]
       +-- [optional local AI worker: off by default]
```
Rust solely owns authorization, transactions, model semantics, calculation, file commit and audit. Sidecars have limited capabilities, launch on demand, do not open project stores or hold master keys, and are killable with bounded restart/backoff. Adapters see only authorized input. Elixir does not own a second DAG; Rust owns it. Monte Carlo calculations later belong in a Rust worker pool; Elixir may coordinate bounded jobs. Retain the five-language intent without requiring five processes at startup. Ship Elixir only after a real workflow need, Windows packaging and runtime-cost spike. If all five are required in V1, make a new decision rather than dummy code.

## Ownership and service contracts
- `ProjectService` opens/unlocks, obtains a single-owner OS lock, enforces capabilities and sequences mutation/audit. One active writer per project; other instances receive a locked notice.
- `ModelService` holds revisioned dimensions, formulas, graph and results; writes use expected revision and return new revision or conflict.
- `ImportService` stages adapter outputs; Rust alone commits. Idempotency uses batch ID plus source and mapping/config hashes. Explicit intentional reimport is a distinct batch.
- `QueryService` applies authorization before results/aggregation and returns revision. No unrestricted SQL to UI or sidecars.
- Future workflow workers return proposals/jobs, never direct mutations. Read models/caches are disposable.

## Control and data IPC
Default proposal: bounded versioned Protobuf frames over private inherited stdin/stdout for child sidecars, reserving stdout for frames and stderr for redacted logs. A separate independently launched Excel process cannot inherit those child pipes: use authenticated named-pipe IPC if proven for its implementation. Other transports require a spike/ADR. No long-running pipe server in the Excel UI thread. Pipe ACL restricts current user and expected process identities where feasible; reject remote clients; use random per-launch name and secret via protected inherited handle, not command-line or logs. Same-user malware remains a threat. Include protocol/capability handshake, correlation ID, deadline, cancellation, size limits, backpressure, errors, idempotency key and shutdown. Validate all fields. No unauthorized localhost listener.

Begin bulk transfer with chunked Arrow IPC or validated staged files; optimize after measurement. Arrow C Data Interface pointer handoff is in-process; raw pointers are invalid in another process. A Windows mapping would transfer a secured handle/name plus offsets, lengths, schema/version and integrity metadata, not addresses. Require ACL, bounds/alignment checks, immutable published buffers, lifetime/ack ownership, crash cleanup and quotas. Some compatible paths may be zero-copy; CSV parsing, encryption, importing and rendering still require work/copies. No universal sub-millisecond promise.

## Storage and crash-consistent protocol
Authoritative state: encrypted SQLCipher SQLite containing metadata, revisioned assumptions/edits, mappings, batch manifests, audit and checkpoint pointers, committed in SQLite transactions. DuckDB is a rebuildable analytical projection; only Rust opens it read-write. Durable source records live in immutable encrypted batch artifacts referenced by SQLite manifest/digest; deterministic calculations rebuild projections. Pin/test DuckDB encryption, temp-file settings, extension packaging and migration; SQLCipher does not encrypt DuckDB. No atomic commit across SQLite, DuckDB and files is assumed.

**Import state machine:**
1. Validate external input into encrypted staging artifact on the same local volume. Enforce size/schema/mapping; flush and compute digest. No project state changes.
2. Finalize artifact under immutable unique name with durable rename; verify digest. Crash here leaves an orphan for delayed GC.
3. In one SQLite transaction verify permissions/revision, insert batch manifest, provenance, audit event and projection generation, then commit. This is the visibility point; repeat keyed request returns original result. Before this point import is not committed.
4. Update/rebuild DuckDB from committed manifests. If interrupted, mark stale; reopen verifies artifacts and replays/rebuilds committed generation. Dependent reports visibly wait/refuse until consistent. DuckDB failure cannot undo/falsify authoritative commit. Export pins a fully materialized revision.
5. Recovery scans committed manifests for missing/corrupt artifacts, blocks affected reporting and offers verified restore. GC removes only unreferenced artifacts after grace period. Inject crashes at every transition and test disk-full, access denied, duplicate and corruption; verify flush/rename behavior on supported Windows filesystems.

For edits, validation, expected-revision check, authoritative values, audit and revision commit together; cache is recomputable. Snapshot/export pins a consistent revision and artifacts. Use SQLite backup/checkpoint support, not raw copying of a live DB. GC traces all retained snapshots/exports. Never assume multi-database atomicity.

## Workspace and data model
```text
project/manifest.json             # minimal non-sensitive format/version
project/state.db                  # encrypted state incl. audit
project/artifacts/<opaque-id>     # encrypted immutable inputs/snapshots
project/projections/analysis.db   # encrypted rebuildable projection
project/tmp/                      # protected and encrypted if on disk
```
Working format is directory; `.fpa` is encrypted, integrity-checked portable export, not a live archive. Export version/KDF/nonces/authenticated header and encrypted manifest/artifacts; use vetted libraries. Reject traversal, bombs, unknown schemes, excessive sizes and downgrade. Test restore to a different account/device using recovery key.

Stable IDs rather than names. Coordinate = model + scenario + measure + ordered dimension members + period; validate grain. Sparse means absent, not zero. Start indexed relational/sparse representation and batch evaluation; choose custom CSF only after real benchmarks. Memory depends on populated values, indexes and shape; viewport virtualization doesn't render millions of cells simultaneously.

## Intended monorepo (create on implementation)
```text
AGENTS.md STATUS.md docs/ decisions/ requirements/ test-vectors/
proto/                    # approved schemas
apps/desktop-ui/          # TypeScript + React + Tauri
crates/host/ model/ storage/   # Rust
services/data-adapter/    # Go, optional
services/document-adapter/ # Java, optional
services/workflow/        # Elixir, later optional
blueprints/ fixtures/synthetic/ scripts/windows/ tests/integration/
```
Pin tested toolchains and lockfiles at bootstrap, not fabricated versions now. Each boundary owns schema and compatibility suite. Offline developer builds require separate artifact mirror/vendor-cache decisions.
