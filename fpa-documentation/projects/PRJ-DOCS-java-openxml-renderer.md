# PRJ-DOCS — Java 25 jlink Streaming OpenXML Board Pack Renderer

**Sub-Project ID:** `PRJ-DOCS` · **Target Binary:** `fpa-docs.exe` (~45 MB trimmed image) · **Language:** Java 25 LTS (`jlink`) + Apache POI SXSSF · **Phases Unlocked:** `P6` · **Fallback:** `Rust rust_xlsxwriter basic grid` (`I30`) · **Status:** Contract-specified (`not yet built in Linux UI preview`)

---

## 1. Identity & Ownership Boundary

`PRJ-DOCS` renders institutional **management reporting workbooks, consolidation board packs, and Project P&L / WBS executive exports** from customer-supplied `.xlsx` / `.xlsm` templates while preserving embedded charts, pivot caches, VBA/macro signatures, and conditional styles.

- **Offline Packaging Rule (`I24`)**: Compiled into a self-contained ~45 MB `jlink` native image bundled inside the Windows installer — requires zero external JRE installation and zero internet access.

---

## 2. Streaming Safety & Template Integrity Contract

- **Staged Path Boundary**: Communicates with `PRJ-CORE` strictly via framed `stdio` referencing read-only staged Arrow/JSON export manifests and an explicit user-selected output file path. Never reads arbitrary workspace secrets.
- **Precision Boundary**: Writes exact decimal strings / formula values supplied by `PRJ-CORE` and flags any value exceeding Excel's 15-significant-digit IEEE-754 mantissa boundary before formatting.
- **Rust Fallback (`I30`)**: When disabled in Settings, cleanly delegates tabular exports to `fpa-core`'s Rust `rust_xlsxwriter` fallback without stalling board reporting.

---

## 3. Owned Invariants

`PRJ-DOCS` enforces: `I19`, `I24`, `I30`.

---

## 4. Phase Exit Gate & Verification Command

- **Phase P6 Gate**: `jlink-runtime/bin/fpa-docs.exe --self-test --template-roundtrip` (verifies template chart/macro preservation on offline Windows 11 host).
