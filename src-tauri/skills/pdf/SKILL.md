---
name: pdf
description: Generate paginated A4 PDFs with a title, headings, paragraphs, lists, tables, and a footer using a stdlib-only Python helper.
---

# PDF documents

Use this skill when the user asks for a **PDF**, a report for printing, a CV, a
contract, or any `.pdf` file to download.

## How it works

The `scripts/make_pdf.py` helper writes the PDF by hand **using only the Python
standard library** (no `pip install`, no `reportlab`): PDF objects, base-14
Helvetica/Helvetica-Bold fonts, content streams compressed with the correct
`/Length`, latin-1 text (so accented characters come out right), line wrapping,
pagination, and a footer. The result opens in the artifacts panel (pdf.js) and
in any reader.

## Recommended flow

1. Call `read_skill("pdf")` and keep the returned `baseDir`.
2. Build the JSON spec and call `run_code` with Python.
3. The helper prints `OK <path> <bytes>` and exits with code 1 on error.
4. The file is collected as an artifact and gets a PDF preview (pages + zoom).

`run_code` example (Python):

```python
import json, os, subprocess, sys

base_dir = r"<baseDir from read_skill>"
spec = {
    "title": "Quarterly Report — Aurora Analytics",
    "subtitle": "Third-quarter 2026 results",
    "footer": "Aurora Analytics · Confidential",
    "blocks": [
        {"type": "heading", "level": 1, "text": "Highlights"},
        {"type": "paragraph", "text": "Revenue grew 18% compared with the previous quarter."},
        {"type": "bullets", "items": ["Revenue: R$ 4.82 million", "Churn: 1.4%"]},
        {"type": "table",
         "headers": ["Product", "Revenue (R$)"],
         "rows": [["Platform", "2,910,000"], ["Integrations", "1,180,000"]]},
        {"type": "page_break"},
        {"type": "heading", "level": 1, "text": "Next steps"},
        {"type": "paragraph", "text": "Keep investing in integrations."},
    ],
}

with open("spec.json", "w", encoding="utf-8") as handle:
    json.dump(spec, handle, ensure_ascii=False, indent=2)

script = os.path.join(base_dir, "scripts", "make_pdf.py")
result = subprocess.run(
    [sys.executable, script, "--spec", "spec.json", "--out", "quarterly-report.pdf"],
    capture_output=True, text=True,
)
print(result.stdout)
print(result.stderr, file=sys.stderr)
if result.returncode != 0:
    raise SystemExit(result.returncode)
```

## Spec format

The spec is the same as the DOCX one (§ `office-docx`):

```json
{
  "title": "optional",
  "subtitle": "optional",
  "footer": "optional — text on the left; pagination is automatic",
  "blocks": [
    {"type": "heading", "level": 1, "text": "Section"},
    {"type": "paragraph", "text": "Text with automatic line wrapping."},
    {"type": "bullets", "items": ["item", "item"]},
    {"type": "table", "headers": ["A"], "rows": [["1"]]},
    {"type": "page_break"}
  ]
}
```

- Text wraps automatically to the usable page width; there is no need to insert
  `\n`.
- The footer shows the given text on the left and `Page X of Y` on the right.
- Tables in the PDF have at most 12 columns (the helper reports an error
  otherwise).
- Extra pages are created automatically when content goes past the footer; use
  `page_break` only when you want to force a break.

## When to use installed libraries

Use `reportlab`/`fpdf2` (if installed — test the import first) only if you need
images, clickable links, complex tables, TTF fonts, or bookmarks, which the
helper does not cover. For running text, lists, and simple tables, prefer the
helper: it needs no dependency.

## Validation

- Check the `OK ...` line and the first bytes of the file: every PDF starts with
  `%PDF-1.4`.
- Open the panel preview to check pages, headings, and pagination.
- On error, fix the spec; do not edit the skill script.
