---
name: office-xlsx
description: Create Excel workbooks (.xlsx) with multiple sheets, bold headers, numbers, formulas, and column widths using a stdlib-only Python helper.
---

# Excel workbooks (.xlsx)

Use this skill when the user asks for a **spreadsheet**, an Excel table, a
budget, a number tracker, or any `.xlsx` file.

## How it works

The `scripts/make_xlsx.py` helper builds the OOXML package from scratch **using
only the Python standard library** (no `pip install`). It produces a valid
`.xlsx` with multiple sheets, a bold header row, number formatting, column
widths, and cached values for simple formulas (`=SUM(...)`, `=AVERAGE(...)`), so
the preview shows the result before the file is opened in Excel.

## Recommended flow

1. Call `read_skill("office-xlsx")` and keep the returned `baseDir`.
2. Build the JSON spec and call `run_code` with Python.
3. The helper prints `OK <path> <bytes>` and exits with code 1 on error.
4. The file is collected as an artifact and gets a grid preview with sheet tabs.

`run_code` example (Python):

```python
import json, os, subprocess, sys

base_dir = r"<baseDir from read_skill>"
spec = {
    "title": "Q3 Sales",
    "sheets": [
        {
            "name": "Sales",
            "rows": [
                ["Month", "Revenue", "New customers"],
                ["July", 1410000, 12],
                ["August", 1580000, 18],
                ["September", 1830000, 27],
                ["Total", "=SUM(B2:B4)", "=SUM(C2:C4)"],
            ],
            "formats": {"B2": "#,##0", "B3": "#,##0", "B4": "#,##0", "B5": "#,##0"},
        },
        {"name": "Targets", "rows": [["Region", "Target"], ["South", 900000]]},
    ],
}

with open("spec.json", "w", encoding="utf-8") as handle:
    json.dump(spec, handle, ensure_ascii=False, indent=2)

script = os.path.join(base_dir, "scripts", "make_xlsx.py")
result = subprocess.run(
    [sys.executable, script, "--spec", "spec.json", "--out", "sales.xlsx"],
    capture_output=True, text=True,
)
print(result.stdout)
print(result.stderr, file=sys.stderr)
if result.returncode != 0:
    raise SystemExit(result.returncode)
```

## Spec format

```json
{
  "sheets": [
    {
      "name": "Sales",
      "rows": [["Month", "Revenue"], ["July", 1410000], ["Total", "=SUM(B2:B2)"]],
      "formats": {"B2": "#,##0"},
      "widths": [18, 14]
    }
  ]
}
```

- `rows`: a list of rows; cells accept text, number, boolean, or a formula
  (a string starting with `=`).
- The **first row** of each sheet is the header and is rendered in bold.
- `formats` (optional): cell → format code map, e.g. `#,##0`, `0.00`, `0%`,
  `dd/mm/yyyy`.
- `widths` (optional): a list of widths or a map `{"A": 18}`; without it, the
  width is calculated from the content.
- Sheet names are sanitized (max. 31 characters, no `[]:*?/\`) and
  deduplicated.
- Formulas are written as real formulas; the cached value is calculated when the
  formula is simple (SUM/AVERAGE/MIN/MAX/COUNT over ranges, or arithmetic with
  cells). Complex formulas are left without a cached value and Excel recalculates
  when the file is opened.

## When to use installed libraries

Use `openpyxl` (if installed — test `import openpyxl` first) only if you need
charts, pivot tables, images, conditional styles, or cell merging, which the
helper does not cover. For the common case, prefer the helper: it needs no
dependency and the file opens in the app preview right away.

## Validation

- Check the `OK ...` line in stdout and the file size.
- Open the spreadsheet in the artifacts panel preview to check sheets and values.
- On error, fix the spec; do not edit the skill script.
