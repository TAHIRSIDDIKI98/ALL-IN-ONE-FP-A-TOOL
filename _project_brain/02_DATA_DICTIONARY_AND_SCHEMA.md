# 02 — Data dictionary and schema

Status: NO IMPLEMENTED DATABASE OR EXACT SCHEMA · 18 Nov 2026

## Hard rule
Before writing any query, migration or model code, inspect the actual code/database schema and compare with this file and the approved schema spec. **No physical table or column name is approved or implemented yet.** Do not use conceptual names below as real identifiers. If an exact field/type/constraint is absent, stop and ask for approval rather than inventing one. A future proposal becomes authoritative only after an ADR, finance/security review, approved migration and verified test.

## Data classes — conceptual, not SQL tables
| Concept | Required content / relationship to determine | Owner or blocker |
|---|---|---|
| Project / revision | stable workspace ID, format version, data revision, commit generation; encryption and recovery | storage/security spec pending |
| Legal entity / reporting group | approved legal identity, effective-dated inclusion/control, functional currency, ownership and reporting hierarchy | company/group finance review pending |
| Business unit / industry | unit belongs to approved entity/time scope; a brand is not necessarily a legal entity | portfolio identity/ownership pending |
| Account / chart mapping | stable account, source/target, sign, statement and aggregation policy, effective dates | finance approval pending |
| Period / calendar | dates, fiscal mapping, time zone, lock/restate policy | finance approval pending |
| Financial facts / source provenance | entity, coordinate, unit, decimal amount, scenario, version, source batch and line **where available** | approved import contract pending |
| Formula / assumption / override | expression, type, units, dimensional grain, revision, source/precedence | model and finance spec pending |
| Currency rate | currency pair/direction, date, rate type/source/version, decimal rate, applicability | IAS 21 policy review pending |
| Consolidation | control assessment, scope and methods, currency translation, adjustments, IC match/elimination, NCI and approved journals | group finance spec pending |
| Operation and idempotency | stable scoped request key, hash, state/result, commit revision and retention | atomic transaction semantics pending |
| Audit event/checkpoint | committed action, actor caveat, revision, reason, chain and checkpoint evidence | security/retention review pending |
| Export/backup | revision-pinned manifest and encrypted artifacts; recovery envelope | crypto/restore spike pending |

## Provisional type rules — not yet SQL DDL
An external AI proposed 128-bit scaled Rust calculations, 4-decimal money and 8-decimal FX/ownership; all are **unapproved examples**, not decided policy. Authoritative f64 is prohibited. SQLite INTEGER is i64 if selected, so representation, explicit bound and overflow behavior require design approval; storage scale is not necessarily currency minor units. Dates/time: ISO representations with explicit calendar/time zone conventions, effective range inclusive start/exclusive end. IDs: stable, not display names. Distinguish null, zero, unavailable, invalid and error. Relationships: validated references, unique coordinate, versioned membership and acyclic valid hierarchy where applicable. Financial mutation + idempotency + audit + revision in one authoritative ACID transaction; artifact/DB protocol described in architecture.

## Required schema deliverable before implementation
`schema_version`, dialect, all exact names, storage encodings, PK/FK/unique/check constraints, nullability, indexes, cascading behavior, types, reference to finance policies, migration and rollback, encryption coverage, supported version, example data and atomicity. Review with finance/security owner. Until then status is **blocked/unapproved**, not an empty schema that an agent may silently fill.
