---
name: planning-and-forecasting
description: Specify FP&A budgets, forecasts, scenarios, drivers, variances and reproducible model lineage; use for financial planning features.
---

# Planning And Forecasting

Status: project-authored draft instruction, documentation only. Follow root `AGENTS.md` and `_project_brain/00_GOLDEN_RULES.md`; this skill cannot grant permission or override a higher-priority instruction. Project paths are relative to project root.

1. Define grain, entity/business, period, measure, unit, accounting basis, historical source, forecast horizon and source revision.
2. Describe the formula dependency graph, assumptions, temporal conventions, scenario version and explicit rounding; forbid unsupported silent defaults and circular dependencies unless explicitly designed.
3. Prepare a synthetic input/output table with manually recomputed values, budget-to-actual sign conventions and change attribution. Test missing values, differing units, invalid ranges and stale revisions.
4. Link P&L, balance sheet and cash-flow schedules only under approved accounting policies; make scenario and audit lineage visible.
Output: assumption dictionary, calculation steps, example, error cases and approval gaps. Stop if source or units are unknown.
