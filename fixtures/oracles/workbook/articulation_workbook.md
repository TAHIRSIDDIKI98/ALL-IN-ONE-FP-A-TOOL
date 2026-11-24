# OneFP&A — Articulation & Corpus Verification Workbook

- **Derivation Method**: Owner-auditable hand tie-out paired with `/scripts/generate-independent-oracles.ts` (pure JS `BigInt` integer minor-unit summation, zero `/core` imports)
- **Approved Date**: `2026-11-24`
- **Corpus Reference**: `Sample Co — DEMO — SYNTHETIC DATA` (`seed = 202601`, `generatorVersion = 1.0.0`, `FY2026`, `USD`, `scale = 2`)

---

## 1. Permanent EBITDA Oracle (MASTER_PROMPT §5.5 / §7.5)

| Component | Natural Formula | Exact Value (`USD`) |
|---|---|---:|
| Revenue (`4000`, credit-normal) | `credit(1000.00) - debit(0.00)` | `1000.00` |
| Cost of Goods Sold (`5000`, debit-normal) | `debit(400.00) - credit(0.00)` | `400.00` |
| **Gross Profit** | `1000.00 - 400.00` | **`600.00`** |
| Operating Expenses (`6000`, debit-normal) | `debit(300.00) - credit(0.00)` | `300.00` |
| **EBITDA** | `600.00 - 300.00` | **`+300.00`** |

---

## 2. Corpus FY2026 Articulation Summary (A1–A5 Exact Tie-Out)

### A1 — Trial Balance Identity
- `Total Debits` = `20,237,811.00` (`2,023,781,100` minor cents)
- `Total Credits` = `20,237,811.00` (`2,023,781,100` minor cents)
- `Delta (Debits - Credits)` = **`0.00`** (EXACT)

### A2 — Income Statement Waterfall
| Line | Formula | Amount (`USD`) |
|---|---|---:|
| Revenue | Sum(`pl.revenue.*`) | `6,509,493.00` |
| Cost of Goods Sold | Sum(`pl.cogs.*`) | `2,193,359.00` |
| **Gross Profit** | `Revenue - COGS` | **`4,316,134.00`** |
| Operating Expenses | Sum(`pl.opex.*`) | `3,004,027.00` |
| **EBITDA** | `Gross Profit - OpEx` | **`1,312,107.00`** |
| Depreciation & Amortization | Sum(`pl.da.*`) | `239,914.00` |
| **EBIT** | `EBITDA - D&A` | **`1,072,193.00`** |
| Non-Operating Net | Interest Income - Interest Expense | `-72,088.00` |
| **EBT** | `EBIT + Non-Operating Net` | **`1,000,105.00`** |
| Income Tax Expense | Sum(`pl.tax.*`) | `214,930.00` |
| **Net Income** | `EBT - Tax` | **`785,175.00`** |

### A3 — Balance Sheet Equation (`Assets == Liabilities + Equity`)
| Side | Components | Amount (`USD`) |
|---|---|---:|
| Current Assets | Cash `2,110,947.70` + AR + Inventory + Other CA | `4,331,862.10` |
| Non-Current Assets | Gross PP&E `2,080,000.00` - Accum Depr `689,914.00` + Security Deposits `50,000.00` | `1,440,086.00` |
| **Total Assets** | `Current + Non-Current` | **`5,771,948.10`** |
| Current Liabilities | AP + Accrued + Deferred Rev + Short-Term Debt | `1,361,773.10` |
| Non-Current Liabilities | Term Loan (`600k + 250k - 100k = 750k`) + Lease `100k` | `850,000.00` |
| **Total Liabilities** | `Current + Non-Current` | **`2,211,773.10`** |
| **Total Equity** | Common Stock `1,650,000.00` + Opening RE `1,200,000.00` + NI `785,175.00` - Distributions `75,000.00` | **`3,560,175.00`** |
| **Liabilities + Equity** | `2,211,773.10 + 3,560,175.00` | **`5,771,948.10`** |
| `Delta (Assets - (L+E))` | — | **`0.00`** (EXACT)

### A4 — Retained Earnings Roll-Forward
- `Opening Retained Earnings`: `1,200,000.00`
- `+ Full Year Net Income`: `785,175.00`
- `- Shareholder Distributions`: `75,000.00`
- `Closing Retained Earnings`: **`1,910,175.00`** (`Delta = 0.00`)

### A5 — Indirect Cash Flow Tie-Out (`Ending Cash == BS Cash`)
- `Beginning Cash`: `1,200,000.00`
- `Cash Flow from Operating Activities (CFO)`: `965,947.70` (NI `785,175.00` + D&A `239,914.00` + Working Capital `-59,141.30`)
- `Cash Flow from Investing Activities (CFI)`: `-280,000.00` (Capex P02 `80k` + P06 `120k` + P09 `80k`)
- `Cash Flow from Financing Activities (CFF)`: `225,000.00` (Debt Draw `250k` - Repayment `100k` + Equity `150k` - Dividend `75k`)
- `CF Ending Cash`: **`2,110,947.70`** == `BS Cash`: **`2,110,947.70`** (`Delta = 0.00`)
