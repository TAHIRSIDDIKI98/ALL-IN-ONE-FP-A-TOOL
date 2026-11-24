# PRJ-FLOW — Elixir OTP Close-Calendar Saga & Exception Orchestrator

**Sub-Project ID:** `PRJ-FLOW` · **Target Binary:** `fpa-flow --start-epmd false` · **Language:** Elixir / OTP 27 · **Phases Unlocked:** `P5` · **Fallback:** `Rust sequential state-machine` (`I30`) · **Status:** Contract-specified (`not yet built in Linux UI preview`)

---

## 1. Identity & Ownership Boundary

`PRJ-FLOW` manages fault-tolerant **close-calendar dependency DAGs, multi-step consolidation approval sagas, and canonical exception triage aggregation** across entities and projects.

- **Critical Windows Constraint (`I18`)**: Must always execute with `--start-epmd false -elixir ansi_enabled false` so Erlang Port Mapper Daemon never opens loopback TCP listeners or triggers Windows Defender Firewall popups.

---

## 2. IPC, Saga & Exception Key Contract

- **IPC Transport**: Length-prefixed JSON-RPC / ETF frames strictly over inherited OS `stdin`/`stdout` pipes supervised by `PRJ-CORE`. Zero network sockets, zero UDP/TCP discovery.
- **Canonical Finding Key (`K3`, `I15`)**: Aggregates all 24 exception categories under the deterministic uppercase 5-part key `RULE_ID|ENTITY_CODE|ACCOUNT_CODE|PERIOD_CODE|GRAIN`, eliminating duplicate/orphan alert storms.
- **Per-Project Close Segregation (`I37`)**: Every close saga carries an immutable `(project_id, period_code, head_revision)` tuple; period locks prevent retroactive mutation without an audited reopen command (`I06`).

---

## 3. Owned Invariants

`PRJ-FLOW` enforces: `I15`, `I18`, `I30`.

---

## 4. Phase Exit Gate & Verification Command

- **Phase P5 Gate**: `mix test && powershell -c "Get-NetTCPConnection -OwningProcess $FlowPid"` (must return **0 open TCP/UDP listeners** on Windows 11).
