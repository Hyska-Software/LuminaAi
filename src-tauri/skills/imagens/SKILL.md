---
name: imagens
description: Create SVG images (via create_file) and PNG/JPG images (with Pillow or matplotlib when installed) for charts, icons, and illustrations.
---

# Images: SVG, PNG, and JPG

Use this skill when the user asks for an **image**, an icon, a simple logo, a
chart, a diagram, or an illustration for a document/report.

## Golden rule

1. **SVG first** whenever possible: it is plain text, always works, opens in the
   artifacts panel (sandboxed iframe), and can be embedded in HTML/reports.
   Create it with the `create_file` tool (name `something.svg`, SVG XML content).
2. **PNG/JPG** only when a raster format is required (photo, texture, chart with
   fine detail). Use `run_code` with **Pillow** or **matplotlib**; if neither is
   installed, fall back to SVG.

## SVG via `create_file`

Example content for `create_file(name="revenue-q3.svg", content=..., mime="image/svg+xml")`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" role="img" aria-label="Quarterly revenue">
  <rect width="640" height="360" fill="#ffffff"/>
  <text x="24" y="36" font-family="sans-serif" font-size="20" fill="#111827">Quarterly revenue</text>
  <g fill="#2563eb">
    <rect x="60" y="220" width="70" height="90"/>
    <rect x="180" y="170" width="70" height="140"/>
    <rect x="300" y="110" width="70" height="200"/>
    <rect x="420" y="60" width="70" height="250"/>
  </g>
  <g font-family="sans-serif" font-size="13" fill="#374151" text-anchor="middle">
    <text x="95" y="334">Q1</text><text x="215" y="334">Q2</text>
    <text x="335" y="334">Q3</text><text x="455" y="334">Q4</text>
  </g>
</svg>
```

SVG rules:

- Always include `xmlns="http://www.w3.org/2000/svg"` and a `viewBox` (do not
  rely on fixed width/height).
- No `<script>`, `foreignObject`, `onclick`, external fonts, or remote `href`:
  the preview sanitizes and removes/ignores them.
- Prefer shapes and `path`; for text use `font-family="sans-serif"` (the system
  font).
- Use the design colors (`#2563eb`, `#111827`, `#6b7280`, `#e5e7eb`, ...).

## PNG/JPG via `run_code` (Pillow)

Only use it if Pillow is installed (check the import first):

```python
try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    raise SystemExit("Pillow not installed: generate an SVG with create_file")

img = Image.new("RGB", (960, 540), "#ffffff")
draw = ImageDraw.Draw(img)
font = ImageFont.load_default()
draw.text((24, 24), "Quarterly revenue", fill="#111827", font=font)
values = [90, 140, 200, 250]
for i, value in enumerate(values):
    x = 60 + i * 120
    draw.rectangle([x, 480 - value, x + 70, 480], fill="#2563eb")
    draw.text((x + 12, 484), f"Q{i + 1}", fill="#374151", font=font)
img.save("revenue-q3.png")
print("OK revenue-q3.png")
```

- `run_code` runs in the workspace and the new file is collected as an artifact;
  the panel shows the image directly.
- Use `ImageFont.truetype(...)` only if you are sure of the font path;
  `ImageFont.load_default()` always works.
- If `import PIL` fails, do **not** try to install it: generate an equivalent SVG
  with `create_file` and tell the user.

## Charts with matplotlib (optional)

If the user asks for a more elaborate chart and `matplotlib` is installed, use
`run_code`:

```python
import matplotlib
matplotlib.use("Agg")          # no display, terminal environment
import matplotlib.pyplot as plt

fig, ax = plt.subplots(figsize=(8, 4.5), dpi=120)
ax.bar(["Q1", "Q2", "Q3", "Q4"], [90, 140, 200, 250], color="#2563eb")
ax.set_title("Quarterly revenue")
ax.spines[["top", "right"]].set_visible(False)
fig.tight_layout()
fig.savefig("revenue-q3.png")
print("OK revenue-q3.png")
```

Before using it, test `import matplotlib`; if it fails, use Pillow or SVG.

## When to use each format

| Need | Format |
| --- | --- |
| Icon, diagram, simple chart, image for HTML/Markdown | SVG (`create_file`) |
| Raster photo/illustration, chart with Pillow/matplotlib | PNG (`run_code`) |
| Image with a transparent background | PNG with `RGBA` |
| No Pillow and no matplotlib | SVG (always works) |

## Validation

- SVG: the file starts with `<svg` and the content is well-formed XML.
- PNG/JPG: the file size is > 0 and `run_code` exited 0.
- Check the result in the artifacts panel; images appear directly, SVG appears in
  the sanitized iframe.
