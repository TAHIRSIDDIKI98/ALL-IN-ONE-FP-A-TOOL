# 03 — API and contract registry

Status: NO API, ENDPOINT, PROTO OR XLL FUNCTION IMPLEMENTED · 18 Nov 2026

## Rule
No physical route, function, protobuf message, field or error code exists or has been approved. Check actual repository and approved schema before use. Items below are **logical candidates**, not callable endpoints; no exact wire payload is authorized. If task requires one, draft and approve a contract first.

## Candidate contracts / acceptance constraints
| Candidate capability | Request concepts | Response concepts | Mandatory conditions |
|---|---|---|---|
| Project open/unlock | selected project + authorized recovery mechanism | session and revision or clear error | no account/network; never log secrets |
| Import preview/commit | file source, mapping/version, entity, request key, expected revision | validation/reconciliation; committed batch and revision, or error | strict all-or-nothing; stable request hash; persisted idempotency |
| Read model value | explicit workspace/entity/coordinate/scenario/period/revision | decimal value + units/currency/status + revision | authorization before aggregation; no silent stale/zero |
| Excel GET | same coordinate and revision, via native Office 2021 x64 | safe Excel value or visible error/status | read-only; explicit decimal/binary conversion and refresh behavior |
| Excel push command | reviewed selected batch + expected revision + request key | one committed revision/audit or detailed rejection | user confirmation; atomic batch; no worksheet-UDF write |
| Consolidate | confirmed scope/policies, period, entity inputs, rate and revision | report generation, controls, reconciliation and lineage | no default invented control/FX/IC, block approved output on missing inputs |
| Operation status | persistent request key and workspace | committed/rejected/unknown with revision, as permitted | resolve timeout/crash before retry; idempotent semantics |
| Backup / restore | pinned revision + verified user-selected destination/recovery method | verified encrypted artifact or explicit failure | user must be able to recover on another account/device |

## Contract design gate
For every contract, approve exact transport/direction, name/version, request/response schema, required/optional/null semantics, decimal representation, error namespace/codes, auth, timeout/cancel, quotas, idempotency/retry, concurrency and compatibility. Include positive/negative/crash tests and redaction. Until approved, **there are no numerical error codes or public endpoints to cite**. Do not expose arbitrary SQL, shell or untrusted model output as APIs. Decimal money/rates must not travel as JSON binary floats. External endpoints/cloud are absent by default.

## Excel constraints
A Rust XLL is a feasibility candidate, not yet proven against Office 2021 x64. Its own UI command and `FPA.GET` are only proposed names until implemented/tested. Worksheet functions do not mutate financial state. Document cached workbook values and manual/automatic recalculation limitations. See `../fpa-documentation/docs/11-uae-excel-v1.md` and `18-engineering-and-finance-decisions.md`.
