---
name: office-pptx
description: Cria apresentações PowerPoint (.pptx) com capa, slides título+bullets e notas do apresentador usando um helper Python só com stdlib.
---

# Apresentações PowerPoint (.pptx)

Use esta skill quando o usuário pedir **slides**, uma apresentação, deck
executivo ou qualquer arquivo `.pptx`.

## Como funciona

O helper `scripts/make_pptx.py` monta o pacote OOXML do zero **somente com a
biblioteca padrão do Python** (sem `pip install`). Ele gera um `.pptx` válido
com capa (título + subtítulo), slides de título + bullets, notas do apresentador
e o pacote completo — apresentação, slide master, layouts, tema, slides, slides
de notas, relacionamentos e tipos de conteúdo.

## Fluxo recomendado

1. Chame `read_skill("office-pptx")` e guarde o `baseDir`.
2. Monte o spec JSON e chame `run_code` com Python.
3. O helper imprime `OK <caminho> <bytes>` e sai com código 1 em erro.
4. O arquivo é coletado como artefato e ganha preview em cartões de slide.

Exemplo de `run_code` (Python):

```python
import json, os, subprocess, sys

base_dir = r"<baseDir do read_skill>"
spec = {
    "title": "Aurora Analytics — Resultados Q3 2026",
    "subtitle": "Apresentação executiva",
    "slides": [
        {
            "title": "Principais números",
            "bullets": [
                "Receita: R$ 4,82 mi (+18% QoQ)",
                "Novos clientes: 27",
                {"text": "Churn: 1,4%", "level": 1},
            ],
            "notes": "Mencionar a margem bruta no fim.",
        },
        {
            "title": "Próximos passos",
            "bullets": ["Contratar dois engenheiros de dados", "Expandir integrações"],
        },
    ],
}

with open("spec.json", "w", encoding="utf-8") as handle:
    json.dump(spec, handle, ensure_ascii=False, indent=2)

script = os.path.join(base_dir, "scripts", "make_pptx.py")
result = subprocess.run(
    [sys.executable, script, "--spec", "spec.json", "--out", "apresentacao.pptx"],
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
  "title": "Título da capa",
  "subtitle": "Subtítulo da capa",
  "slides": [
    {"title": "Título do slide", "bullets": ["ponto 1", "ponto 2"], "notes": "fala do apresentador"}
  ]
}
```

- A capa só é gerada quando `title` e/ou `subtitle` existem.
- Cada item de `slides` vira um slide com título e bullets.
- `notes` (opcional) vira o slide de notas do apresentador daquele slide.
- Bullets aceitam `{"text": "...", "level": 1}` para subníveis.
- `subtitle`/`notes` aceitam `\n` para separar linhas.
- Limite: até 200 slides no total.

## Quando usar bibliotecas instaladas

Use `python-pptx` (se estiver instalado — teste `import pptx` antes) apenas se
precisar de imagens, gráficos, tabelas, animações ou posicionamento fino de
formas, que o helper não cobre. Para o caso comum (capa + slides de bullets +
notas), use o helper: não exige dependência e abre na prévia do app.

## Validação

- Confira a linha `OK ...` no stdout e o tamanho do arquivo.
- A prévia do painel mostra cada slide como cartão numerado (título = primeira
  linha, demais linhas como bullets) e as notas quando existirem.
- Em erro, corrija o spec; não edite o script da skill.
