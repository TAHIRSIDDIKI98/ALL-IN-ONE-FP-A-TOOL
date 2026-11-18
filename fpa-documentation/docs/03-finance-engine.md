# 03 — Finance, calculation and model semantics

## Invariants (independently tested)
- FIN-001: posted/reportable amounts use base-10 fixed-scale decimal, not binary float. Currency + explicit scale; overflow is an error. Higher precision for rates/drivers; explicit conversions and rounding boundary. Simulation may use floating point but disclose method and convert outputs deterministically.
- FIN-002: distinguish absent, zero, null, not-applicable and error. Propagate errors with context. Missing mandatory FX/mapping is not zero. Divide by zero gives typed error, never silent Infinity/NaN.
- FIN-003: canonical source sign is debit-positive, credit-negative; presentation sign is separate per report row. Do not double-apply sign. Valid trial balance sums to zero at defined scope/tolerance.
- FIN-004: period identity, inclusive start/exclusive end, timestamp timezone, fiscal-year/week, 53rd week and leap days explicit; calendar definitions versioned. V1 uses selected month fiscal-year start. Rates have currency pair/type/period/source/revision.
- FIN-005: actual data, formulas, overrides and provenance are distinct. Override has scope/reason/author/revision and precedence only for permitted target; removing it restores calculation.
- FIN-006: statements/exports declare scenario/revision, unit, period, currency, sign and rounding. Reconciliation exposes differences.

## Data model
Workspace, Calendar, Period, Entity, Currency, Dimension, Member, effective-dated HierarchyEdge, Account (type/sign/aggregation), Measure (type/unit/aggregation/grain), Module, Coordinate, DataBatch, SourceRecordRef, Mapping, Formula, Dependency, Version/Scenario, Edit, Revision, AuditEvent, Report, Checkpoint, ValidationIssue. Enforce references and hierarchy-cycle checks. Facts are additive, semi-additive (cash ending balance: last period over time) or non-additive (ratio recomputed from numerator/denominator); never sum all metrics blindly. V1 supports additive flows and ending balances with explicit rollup.

## V1 formula language — normative minimum
```ebnf
expr    = sum ;
sum     = product, { ('+' | '-'), product } ;
product = unary, { ('*' | '/'), unary } ;
unary   = ['-'], primary ;
primary = decimal | reference | '(', expr, ')' | prev ;
prev    = 'PREV', '(', reference, ')' ;
```
Whitespace optional; identifiers resolve to stable IDs at compile time. `PREV(reference)` uses previous period in same scenario/scope; first period needs explicit opening input or returns `MISSING_OPENING`. References resolve to one value at current grain; ambiguous dimensional broadcasts and unit incompatibilities are compile errors. Scientific notation, locale-dependent literals, comparisons, IF and textual SUM are unsupported until explicitly specified and tested. Formulas compile to revisioned graph, dependencies first; edits invalidate affected nodes. PREV edges link earlier periods, not cycles when opening exists. Static cycles rejected with path. Later iterative solvers need iteration limit, absolute/relative tolerance, initial seed, reproducibility and `NON_CONVERGED` errors.

Draft default: decimal up to 28 significant digits; currency scale 2 and rate scale 8, half-even rounding at configured output/posting boundary, intermediate precision retained and overflow checked. SME approval and currency exceptions required. Property tests compare incremental to full recalculation and independent reference, including ties/negatives/large values.

## Three-statement boundary
P&L flows, BS stocks, and cash flow derive from approved mappings/schedules, not automatic balancing. Require opening balances and debt/equity/cash-flow category mappings. Indirect CF starts from net income and adjusts non-cash items and movements in non-cash balance-sheet accounts under published sign map. Assets = liabilities + equity in display convention; trial balance = 0 under debit-positive storage. Unmapped/unbalanced data visible; draft may be viewed but cannot be called approved. No silent plug; any configured plug is separately traceable/approved.

### Golden V1 example (USD; debit-positive source; whole units)
Opening BS: cash 100; other assets 0; liabilities 0; equity 100. Journal activity:
```text
Dr Cash 1,000; Cr Revenue 1,000
Dr Operating expense 600; Cr Cash 600
Dr Other asset 100; Cr Cash 100
```
Each journal nets zero. Display: revenue 1,000; expense 600; net income 400. Ending cash 400, other assets 100, liabilities 0, equity 500 (opening 100 + income 400): assets 500 = liabilities + equity 500. Indirect operating CF = income 400 less increase in non-cash assets 100 = 300 (assuming an operating asset); opening cash 100 + CF 300 = ending cash 400. Trace each number to source/mapping. Negative test: remove a credit leg and approval is blocked, not repaired.

## Later specifications required
FX needs functional/presentation currency, period/historical rates, CTA, ownership, rounding, exceptions and policy. IC needs matching, thresholds, inventory profits and journals. Revenue requires contract accounting review. Workforce needs employment dates/proration/caps/effective dates. Depreciation needs in-service conventions, residuals, book/tax and jurisdiction. PVM needs exact waterfall/order and interaction/residual reconciliation. Simulation needs seed/RNG, correlation, distributions, snapshot, quantile interpolation and reproducibility. Solver needs objective/constraints/units, infeasible/unbounded/time-limit statuses, solution gap and licensed backend.
