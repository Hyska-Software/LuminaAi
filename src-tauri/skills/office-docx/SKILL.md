---
name: office-docx
description: Cria documentos Word (.docx) com título, headings, parágrafos, listas, tabelas e quebra de página usando um helper Python só com stdlib.
---

# Documentos Word (.docx)

Use esta skill quando o usuário pedir um **documento Word**, relatório, contrato,
proposta ou qualquer arquivo `.docx` para baixar/abrir no Word, LibreOffice ou
Google Docs.

## Como funciona

O helper `scripts/make_docx.py` monta o pacote OOXML do zero **somente com a
biblioteca padrão do Python** (sem `pip install`). Ele gera um `.docx` válido com
estilos, numeração de listas, tema, rodapé e propriedades. Não é preciso ter
`python-docx` instalado.

## Fluxo recomendado

1. Chame `read_skill("office-docx")` e guarde o `baseDir` devolvido.
2. Monte o spec JSON (abaixo) e chame `run_code` com Python.
3. O helper imprime `OK <caminho> <bytes>` no stdout e sai com código 1 em erro.
4. O arquivo gerado no workspace é coletado automaticamente como artefato e
   aparece no painel com preview HTML.

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
        {"type": "bullets", "items": ["Receita: R$ 4,82 milhões", "Novos clientes: 27"]},
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

script = os.path.join(base_dir, "scripts", "make_docx.py")
result = subprocess.run(
    [sys.executable, script, "--spec", "spec.json", "--out", "relatorio.docx"],
    capture_output=True, text=True,
)
print(result.stdout)
print(result.stderr, file=sys.stderr)
if result.returncode != 0:
    raise SystemExit(result.returncode)
```

## Formato do spec

```json
{
  "title": "opcional",
  "subtitle": "opcional",
  "footer": "opcional — vira o rodapé com numeração de páginas",
  "blocks": [
    {"type": "heading", "level": 1, "text": "Título de seção (level 1..6)"},
    {"type": "paragraph", "text": "Texto corrido."},
    {"type": "bullets", "items": ["item", "item"]},
    {"type": "table", "headers": ["Coluna A"], "rows": [["valor"]]},
    {"type": "page_break"}
  ]
}
```

- `blocks` é obrigatório ser lista, mas pode vir vazio (documento só com título).
- `bullets` aceita `{"text": "...", "level": 1}` para aninhar níveis.
- `table`: `headers` é opcional; `rows` é uma lista de listas de células.
- Não invente tipos de bloco: `heading`, `paragraph`, `bullets`, `table` e
  `page_break`. Outro tipo gera erro explicativo no stderr.

## Quando usar bibliotecas instaladas

O helper cobre o caso comum e sempre funciona. Use `python-docx` (se estiver
instalado — confira antes com `import docx`) apenas se precisar de recursos que o
helper não tem, como imagens embutidas, cabeçalho rico, colunas, sumário
automático ou formatação inline por trecho. Nesse caso:
`subprocess.run([sys.executable, "-c", "...", ...])` também funciona, mas não
presuma que a biblioteca existe: teste o import antes e caia no helper se faltar.

## Validação

- Confira que o stdout termina com uma linha `OK ...` e que o arquivo existe e
  tem tamanho > 0.
- Se o helper retornar erro, corrija o spec e execute de novo; não edite o
  script da skill.
