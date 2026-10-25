---
name: imagens
description: Cria imagens SVG (via create_file) e PNG/JPG (Pillow ou matplotlib quando instalados) para gráficos, ícones e ilustrações.
---

# Imagens: SVG, PNG e JPG

Use esta skill quando o usuário pedir uma **imagem**, ícone, logotipo simples,
gráfico, diagrama ou ilustração para um documento/relatório.

## Regra de ouro

1. **SVG primeiro** quando der: é texto puro, sempre funciona, abre no painel de
   artefatos (iframe sandbox) e pode ser embutido em HTML/relatórios. Crie com a
   ferramenta `create_file` (nome `algo.svg`, conteúdo XML do SVG).
2. **PNG/JPG** apenas quando o formato raster for necessário (foto, textura,
   gráfico com muitos detalhes). Use `run_code` com **Pillow** ou
   **matplotlib**; se nenhum dos dois estiver instalado, caia no SVG.

## SVG via `create_file`

Exemplo de conteúdo para `create_file(name="receita-q3.svg", content=..., mime="image/svg+xml")`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" role="img" aria-label="Receita por trimestre">
  <rect width="640" height="360" fill="#ffffff"/>
  <text x="24" y="36" font-family="sans-serif" font-size="20" fill="#111827">Receita por trimestre</text>
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

Regras do SVG:

- Sempre `xmlns="http://www.w3.org/2000/svg"` e um `viewBox` (não dependa de
  largura/altura fixas).
- Nada de `<script>`, `foreignObject`, `onclick`, fontes externas ou
  `href` remoto: o preview sanitiza e remove/ignora.
- Prefira formas e `path`; para texto use `font-family="sans-serif"` (fonte do
  sistema).
- Use as cores do design (`#2563eb`, `#111827`, `#6b7280`, `#e5e7eb`, ...).

## PNG/JPG via `run_code` (Pillow)

Só use se Pillow estiver instalado (o helper testa antes):

```python
try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    raise SystemExit("Pillow não instalado: gere um SVG com create_file")

img = Image.new("RGB", (960, 540), "#ffffff")
draw = ImageDraw.Draw(img)
font = ImageFont.load_default()
draw.text((24, 24), "Receita por trimestre", fill="#111827", font=font)
valores = [90, 140, 200, 250]
for i, valor in enumerate(valores):
    x = 60 + i * 120
    draw.rectangle([x, 480 - valor, x + 70, 480], fill="#2563eb")
    draw.text((x + 12, 484), f"Q{i + 1}", fill="#374151", font=font)
img.save("receita-q3.png")
print("OK receita-q3.png")
```

- `run_code` roda no workspace e o arquivo novo é coletado como artefato;
  o painel mostra a imagem direto.
- Use `ImageFont.truetype(...)` só se tiver certeza do caminho da fonte;
  `ImageFont.load_default()` sempre funciona.
- Se `import PIL` falhar, **não** tente instalar: gere um SVG equivalente com
  `create_file` e avise o usuário.

## Gráficos com matplotlib (opcional)

Se o usuário pedir um gráfico mais elaborado e `matplotlib` estiver instalado,
use `run_code`:

```python
import matplotlib
matplotlib.use("Agg")          # sem display, ambiente de terminal
import matplotlib.pyplot as plt

fig, ax = plt.subplots(figsize=(8, 4.5), dpi=120)
ax.bar(["Q1", "Q2", "Q3", "Q4"], [90, 140, 200, 250], color="#2563eb")
ax.set_title("Receita por trimestre")
ax.spines[["top", "right"]].set_visible(False)
fig.tight_layout()
fig.savefig("receita-q3.png")
print("OK receita-q3.png")
```

Antes de usar, teste `import matplotlib`; se falhar, use Pillow ou SVG.

## Quando usar cada formato

| Necessidade | Formato |
| --- | --- |
| Ícone, diagrama, gráfico simples, imagem para HTML/Markdown | SVG (`create_file`) |
| Foto/ilustração raster, gráfico com Pillow/matplotlib | PNG (`run_code`) |
| Imagem com fundo transparente | PNG com `RGBA` |
| Sem Pillow e sem matplotlib | SVG (sempre funciona) |

## Validação

- SVG: o arquivo começa com `<svg` e o conteúdo é XML bem formado.
- PNG/JPG: o arquivo tem tamanho > 0 e o `run_code` terminou com exit 0.
- Confira o resultado no painel de artefatos; imagens aparecem direto, SVG
  aparece no iframe sanitizado.
