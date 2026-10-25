---
name: pdf
description: Gera PDFs A4 com título, headings, parágrafos, listas, tabelas e rodapé paginado usando um helper Python só com stdlib.
---

# Documentos PDF

Use esta skill quando o usuário pedir um **PDF**, um relatório para impressão,
um currículo, um contrato ou qualquer arquivo `.pdf` para baixar.

## Como funciona

O helper `scripts/make_pdf.py` escreve o PDF à mão **somente com a biblioteca
padrão do Python** (sem `pip install`, sem `reportlab`): objetos PDF, fontes
base-14 Helvetica/Helvetica-Bold, streams de conteúdo compactados com `/Length`
correto, texto em latin-1 (acentos do português corretos), quebra de linha,
paginação e rodapé. O resultado abre no painel de artefatos (pdf.js) e em
qualquer leitor.

## Fluxo recomendado

1. Chame `read_skill("pdf")` e guarde o `baseDir`.
2. Monte o spec JSON e chame `run_code` com Python.
3. O helper imprime `OK <caminho> <bytes>` e sai com código 1 em erro.
4. O arquivo é coletado como artefato e ganha preview de PDF (páginas + zoom).

Exemplo de `run_code` (Python):

```python
import json, os, subprocess, sys

base_dir = r"<baseDir do read_skill>"
spec = {
    "title": "Relatório Trimestral — Aurora Analytics",
    "subtitle": "Resultados do terceiro trimestre de 2026",
    "footer": "Aurora Analytics · Confidencial",
    "blocks": [
        {"type": "heading", "level": 1, "text": "Destaques"},
        {"type": "paragraph", "text": "A receita cresceu 18% em relação ao trimestre anterior."},
        {"type": "bullets", "items": ["Receita: R$ 4,82 milhões", "Churn: 1,4%"]},
        {"type": "table",
         "headers": ["Produto", "Receita (R$)"],
         "rows": [["Plataforma", "2.910.000"], ["Integrações", "1.180.000"]]},
        {"type": "page_break"},
        {"type": "heading", "level": 1, "text": "Próximos passos"},
        {"type": "paragraph", "text": "Manter o investimento em integrações."},
    ],
}

with open("spec.json", "w", encoding="utf-8") as handle:
    json.dump(spec, handle, ensure_ascii=False, indent=2)

script = os.path.join(base_dir, "scripts", "make_pdf.py")
result = subprocess.run(
    [sys.executable, script, "--spec", "spec.json", "--out", "relatorio.pdf"],
    capture_output=True, text=True,
)
print(result.stdout)
print(result.stderr, file=sys.stderr)
if result.returncode != 0:
    raise SystemExit(result.returncode)
```

## Formato do spec

O spec é o mesmo do DOCX (§ `office-docx`):

```json
{
  "title": "opcional",
  "subtitle": "opcional",
  "footer": "opcional — texto à esquerda; a paginação é automática",
  "blocks": [
    {"type": "heading", "level": 1, "text": "Seção"},
    {"type": "paragraph", "text": "Texto com quebra de linha automática."},
    {"type": "bullets", "items": ["item", "item"]},
    {"type": "table", "headers": ["A"], "rows": [["1"]]},
    {"type": "page_break"}
  ]
}
```

- O texto é quebrado automaticamente na largura útil da página; não é preciso
  inserir `\n`.
- O rodapé mostra o texto informado à esquerda e `Página X de Y` à direita.
- Tabelas no PDF têm no máximo 12 colunas (o helper avisa em erro).
- Páginas extras são criadas automaticamente quando o conteúdo passa do rodapé;
  use `page_break` só quando quiser forçar uma quebra.

## Quando usar bibliotecas instaladas

Use `reportlab`/`fpdf2` (se estiverem instalados — teste o import antes) apenas
se precisar de imagens, links clicáveis, tabelas complexas, fontes TTF ou
marcadores, que o helper não cobre. Para texto corrido, listas e tabelas
simples, prefira o helper: não exige dependência.

## Validação

- Confira a linha `OK ...` e os primeiros bytes do arquivo: todo PDF começa com
  `%PDF-1.4`.
- Abra a prévia do painel para conferir páginas, títulos e paginação.
- Em erro, corrija o spec; não edite o script da skill.
