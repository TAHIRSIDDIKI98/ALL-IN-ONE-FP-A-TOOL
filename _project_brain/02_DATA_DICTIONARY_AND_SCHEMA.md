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

## Provisional type & v3.0 reference rules — physical SQLCipher DDL pending native Rust build
Per Master Architecture v2.2 & v3.0 (`../fpa-documentation/docs/21-master-architecture-v2.2.md`, `docs/22-master-roadmap-and-erp-blueprint-v3.0.md`), the TypeScript reference oracle validates financial amounts, ERP ledger postings, workforce EOSB accruals, CapEx roll-forwards, 13-week cash flows, PVM bridges, and allocation weights using exact `BigInt` scaled integers (`10^-2` minor fils and `10^-4` ratio/weight scale) alongside adaptive `4,096`-cell Block-Hybrid tiers (`EMPTY`, `CONSTANT`, `SPARSE`, `DICT`, `DENSE`). Authoritative `f32`/`f64` floats remain strictly prohibited (`I01`).

- **Universal Top-12 ERP Canonical CoA & Source-Scoped Ingestion (`ERP-01`–`ERP-12`, `IMP-GL` vs `IMP-SUB`, `I33`):** Native ERP fields (`ACDOCA.RACCT`/`SHKZG`, Oracle Flexfields, D365 `MainAccount`, NetSuite `TransactionAccountingLine`, TallyPrime XML/lakh `Dr`/`Cr`, Odoo analytic JSON, Sage `TR_TYPE`, Workday HCM Roster, QuickBooks, Zoho UAE FTA, Infor `FGLEDG`, ISO 21378 / OECD SAF-T) normalize through the 6-stage pipeline into canonical `{ entity, account, costCenter, period, signedAmountFils, gateScope, sha256Manifest }` records. Unmapped ERP accounts route to `QUARANTINED_UNMAPPED_COA`.
- **SQLCipher physical storage caveat:** Native SQLite/SQLCipher `INTEGER` is signed 64-bit; `Fixed128` serialization, exact DDL migrations, foreign-key enforcement, and crash-safe WAL/snapshot envelopes remain gated for the native Rust storage crate and finance/security review before production SQLite deployment.

