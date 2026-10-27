---
name: office-docx
description: Create Word documents (.docx) with a title, headings, paragraphs, lists, tables, and page breaks using a stdlib-only Python helper.
---

# Word documents (.docx)

Use this skill when the user asks for a **Word document**, a report, a contract,
a proposal, or any `.docx` file to download/open in Word, LibreOffice, or
Google Docs.

## How it works

The `scripts/make_docx.py` helper builds the OOXML package from scratch **using
only the Python standard library** (no `pip install`). It produces a valid
`.docx` with styles, list numbering, theme, footer, and properties. No
`python-docx` installation is required.

## Recommended flow

1. Call `read_skill("office-docx")` and keep the returned `baseDir`.
2. Build the JSON spec (below) and call `run_code` with Python.
3. The helper prints `OK <path> <bytes>` to stdout and exits with code 1 on
   error.
4. The generated file in the workspace is collected automatically as an artifact
   and appears in the panel with an HTML preview.

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
        {"type": "bullets", "items": ["Revenue: R$ 4.82 million", "New customers: 27"]},
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

script = os.path.join(base_dir, "scripts", "make_docx.py")
result = subprocess.run(
    [sys.executable, script, "--spec", "spec.json", "--out", "report.docx"],
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
  "title": "optional",
  "subtitle": "optional",
  "footer": "optional — becomes the footer with page numbers",
  "blocks": [
    {"type": "heading", "level": 1, "text": "Section title (level 1..6)"},
    {"type": "paragraph", "text": "Body text."},
    {"type": "bullets", "items": ["item", "item"]},
    {"type": "table", "headers": ["Column A"], "rows": [["value"]]},
    {"type": "page_break"}
  ]
}
```

- `blocks` must be a list but may come empty (a document with only a title).
- `bullets` accepts `{"text": "...", "level": 1}` to nest levels.
- `table`: `headers` is optional; `rows` is a list of lists of cells.
- Do not invent block types: `heading`, `paragraph`, `bullets`, `table`, and
  `page_break`. Any other type produces an explanatory error on stderr.

## When to use installed libraries

The helper covers the common case and always works. Use `python-docx` (if
installed — check first with `import docx`) only if you need features the helper
does not have, such as embedded images, a rich header, columns, an automatic
table of contents, or per-run inline formatting. In that case:
`subprocess.run([sys.executable, "-c", "...", ...])` also works, but do not
assume the library is there: test the import first and fall back to the helper
if it is missing.

## Validation

- Check that stdout ends with an `OK ...` line and that the file exists and has
  size > 0.
- If the helper returns an error, fix the spec and run it again; do not edit the
  skill script.
