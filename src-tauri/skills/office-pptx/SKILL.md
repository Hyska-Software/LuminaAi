---
name: office-pptx
description: Create PowerPoint presentations (.pptx) with a cover slide, title+bullets slides, and speaker notes using a stdlib-only Python helper.
---

# PowerPoint presentations (.pptx)

Use this skill when the user asks for **slides**, a presentation, an executive
deck, or any `.pptx` file.

## How it works

The `scripts/make_pptx.py` helper builds the OOXML package from scratch **using
only the Python standard library** (no `pip install`). It produces a valid
`.pptx` with a cover slide (title + subtitle), title + bullets slides, speaker
notes, and the complete package — presentation, slide master, layouts, theme,
slides, notes slides, relationships, and content types.

## Recommended flow

1. Call `read_skill("office-pptx")` and keep the returned `baseDir`.
2. Build the JSON spec and call `run_code` with Python.
3. The helper prints `OK <path> <bytes>` and exits with code 1 on error.
4. The file is collected as an artifact and gets a preview with slide cards.

`run_code` example (Python):

```python
import json, os, subprocess, sys

base_dir = r"<baseDir from read_skill>"
spec = {
    "title": "Aurora Analytics — Q3 2026 Results",
    "subtitle": "Executive presentation",
    "slides": [
        {
            "title": "Key numbers",
            "bullets": [
                "Revenue: R$ 4.82M (+18% QoQ)",
                "New customers: 27",
                {"text": "Churn: 1.4%", "level": 1},
            ],
            "notes": "Mention gross margin at the end.",
        },
        {
            "title": "Next steps",
            "bullets": ["Hire two data engineers", "Expand integrations"],
        },
    ],
}

with open("spec.json", "w", encoding="utf-8") as handle:
    json.dump(spec, handle, ensure_ascii=False, indent=2)

script = os.path.join(base_dir, "scripts", "make_pptx.py")
result = subprocess.run(
    [sys.executable, script, "--spec", "spec.json", "--out", "presentation.pptx"],
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
  "title": "Cover title",
  "subtitle": "Cover subtitle",
  "slides": [
    {"title": "Slide title", "bullets": ["point 1", "point 2"], "notes": "speaker script"}
  ]
}
```

- The cover slide is generated only when `title` and/or `subtitle` exist.
- Each `slides` item becomes a slide with a title and bullets.
- `notes` (optional) becomes that slide's speaker notes slide.
- Bullets accept `{"text": "...", "level": 1}` for sublevels.
- `subtitle`/`notes` accept `\n` to separate lines.
- Limit: up to 200 slides in total.

## When to use installed libraries

Use `python-pptx` (if installed — test `import pptx` first) only if you need
images, charts, tables, animations, or fine shape positioning, which the helper
does not cover. For the common case (cover + bullet slides + notes), use the
helper: it needs no dependency and opens in the app preview.

## Validation

- Check the `OK ...` line in stdout and the file size.
- The panel preview shows each slide as a numbered card (title = first line,
  remaining lines as bullets) and the notes when present.
- On error, fix the spec; do not edit the skill script.
