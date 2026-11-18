# 06 — AI-agent operating system and documentation

## Purpose
No prompt can guarantee an agent never goes off track. Persistent rules, bounded tasks, tests, independent reviews, decision records and human gates reduce drift. Repository is source of truth, not chat memory. Never mark planned functionality as shipped.

## Document hierarchy and ownership
| Artifact | Purpose / owner | Change trigger |
|---|---|---|
| `AGENTS.md` | agent constraints / owner + tech lead | rule/trust change |
| Product PRD | outcomes, scope, acceptance / product | scope/journey |
| Requirements registry | IDs, priority, status, owner, tests / product | requirement |
| Finance spec | accounting semantics/formulas / SME | calculation/policy |
| Architecture/threat model | boundaries/failures / architect/security | component/data/trust |
| ADR | decision, alternatives, consequences / approver | material design choice |
| API/proto/schema + dictionary | machine contracts / component lead | data/API/storage |
| Test plan/fixtures/goldens | proof/traceability / QA + SME | behavior/defect |
| Runbooks/install/restore | operator procedures / release | operational change |
| STATUS/changelog | current truth/evidence / implementer | each task |

States: Draft → In review → Approved → Superseded/Retired. Each artifact has ID, version, owner, approver, date, dependencies and links. Approved change requires rationale, alternatives, impacted requirements, migration, risks, tests and approval; supersede without erasing history. Git history is useful but not a substitute for sign-off. Do not place secrets, personal data or unrestricted workbooks in agent context.

## Requirement/test traceability
Registry fields: `req_id | statement | priority | release | owner | status | design/ADR | ticket | test_id | result/evidence | approved_by`. Map many-to-many; P0 needs positive, negative and applicable recovery/authorization tests. Unmapped requirements and tests not run stay visible. Example: `PRD-003 → ARCH-INGEST → IMP-001 → T-IMP-001..006 → actual CI/run artifact`. IDs here are initial references; create registry with definitive owners/status after G0, not fictitious evidence.

## ADR template
```text
ADR-ID / title / status / date / owner / approver
Context and requirements
Decision (precise and bounded)
Alternatives and tradeoffs
Security, finance, offline and compatibility impact
Spike evidence, open risks, rollback and review date
```

## Ticket template
```text
ID, title, owner, status, release
Goal, linked requirement/ADR and why
Allowed files / excluded work
Inputs, outputs, exact behavior, assumptions and errors
Acceptance tests: concrete data → observable result
Security, privacy, migration/recovery and offline checks
Commands and evidence; human review/approval
Dependencies, blockers, estimated size and done definition
```
Prefer 0.5–2 days per task; split larger work by vertical value. Code compiling is not acceptance.

## Reusable agent prompts
**Planning:** “Read AGENTS.md, STATUS.md, relevant requirements/specs/ADRs and ticket <ID>. Summarize constraints/conflicts with file citations; propose minimal implementation, acceptance and failure tests. Do not modify files or begin another ticket. Ask for approval for missing business/security decisions.”

**Implementation:** “Implement only approved ticket <ID>. Follow AGENTS.md. List requirement links and planned tests before changing files. Use synthetic data; no network, dependencies or new architecture without approval. Execute available checks; report exact results and unverified Windows behavior. Update traceability and STATUS. Do not claim success without evidence.”

**Independent reviewer:** “Review diff against <ID>, finance invariants, security/offline threat model and acceptance tests. Attempt to falsify claims; inspect errors, migrations and permissions. Report findings by severity with file/line evidence; don't approve your own work or manufacture results.”

**Finance reviewer:** “Independently compute fixtures and reconcile trial balance, statement links, signs, periods, rounding and provenance. Flag ambiguous policy rather than guessing. Record approval and scope.”

## Gates and handoff
Before implementation: task approved, spec unambiguous, tests defined, synthetic data, dependencies/files allowed, rollback known. Before merge: independent review, checks green, docs/mapping updated, financial outputs independently checked. Before release: Windows offline E2E, security/finance review, defect disposition, licenses, restore/upgrade drill and measured performance with evidence. Stop on conflicting requirement, unexplained output, outbound traffic, broken restore, migration ambiguity, leak or missing target Windows access.

New request → impact analysis → changed requirements/spec/ADR/tests → owner approves → small tickets → implement → independent review → publish. Session end records files, decisions, commands/results, unresolved issues, current/next task in STATUS. New agent reads repository, not just chat memory. Human retains final responsibility.


## v0.2 user constraints
Native Excel add-in is mandatory in V1 and must pass the acceptance gate in `11-uae-excel-v1.md`; UAE and single-user are confirmed. `12-feedback-adjudication.md` rejects unsafe claims from the three AI inputs. The detailed solo loop and case IDs are in `13-agent-control-system.md`.
