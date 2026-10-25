---
name: office-xlsx
description: Cria planilhas Excel (.xlsx) com múltiplas abas, cabeçalho negrito, números, fórmulas e larguras usando um helper Python só com stdlib.
---

# Planilhas Excel (.xlsx)

Use esta skill quando o usuário pedir uma **planilha**, tabela em Excel,
orçamento, acompanhamento de números ou qualquer arquivo `.xlsx`.

## Como funciona

O helper `scripts/make_xlsx.py` monta o pacote OOXML do zero **somente com a
biblioteca padrão do Python** (sem `pip install`). Ele gera `.xlsx` válido com
múltiplas abas, cabeçalho em negrito, formatação numérica, larguras de coluna e
valores em cache para fórmulas simples (`=SUM(...)`, `=AVERAGE(...)`), para a
prévia mostrar o resultado antes de abrir no Excel.

## Fluxo recomendado

1. Chame `read_skill("office-xlsx")` e guarde o `baseDir`.
2. Monte o spec JSON e chame `run_code` com Python.
3. O helper imprime `OK <caminho> <bytes>` e sai com código 1 em erro.
4. O arquivo é coletado como artefato e ganha preview em grade com abas.

Exemplo de `run_code` (Python):

```python
import json, os, subprocess, sys

base_dir = r"<baseDir do read_skill>"
spec = {
    "title": "Vendas Q3",
    "sheets": [
        {
            "name": "Vendas",
            "rows": [
                ["Mês", "Receita", "Clientes novos"],
                ["Julho", 1410000, 12],
                ["Agosto", 1580000, 18],
                ["Setembro", 1830000, 27],
                ["Total", "=SUM(B2:B4)", "=SUM(C2:C4)"],
            ],
            "formats": {"B2": "#,##0", "B3": "#,##0", "B4": "#,##0", "B5": "#,##0"},
        },
        {"name": "Metas", "rows": [["Região", "Meta"], ["Sul", 900000]]},
    ],
}

with open("spec.json", "w", encoding="utf-8") as handle:
    json.dump(spec, handle, ensure_ascii=False, indent=2)

script = os.path.join(base_dir, "scripts", "make_xlsx.py")
result = subprocess.run(
    [sys.executable, script, "--spec", "spec.json", "--out", "vendas.xlsx"],
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
  "sheets": [
    {
      "name": "Vendas",
      "rows": [["Mês", "Receita"], ["Julho", 1410000], ["Total", "=SUM(B2:B2)"]],
      "formats": {"B2": "#,##0"},
      "widths": [18, 14]
    }
  ]
}
```

- `rows`: lista de linhas; células aceitam texto, número, booleano ou fórmula
  (string começando com `=`).
- A **primeira linha** de cada aba é o cabeçalho e sai em negrito.
- `formats` (opcional): mapa célula → código de formato, ex. `#,##0`, `0.00`,
  `0%`, `dd/mm/yyyy`.
- `widths` (opcional): lista de larguras ou mapa `{"A": 18}`; sem isso a largura
  é calculada pelo conteúdo.
- Nomes de aba são saneados (máx. 31 caracteres, sem `[]:*?/\`) e
  deduplicados.
- Fórmulas são gravadas como fórmulas de verdade; o valor em cache é calculado
  quando é simples (SUM/AVERAGE/MIN/MAX/COUNT sobre intervalos ou aritmética com
  células). Fórmulas complexas ficam sem valor em cache e o Excel recalcula ao
  abrir.

## Quando usar bibliotecas instaladas

Use `openpyxl` (se estiver instalado — teste `import openpyxl` antes) apenas se
precisar de gráficos, tabelas dinâmicas, imagens, estilos condicionais ou
mesclagem de células, que o helper não cobre. Para o caso comum, prefira o
helper: não exige dependência e o arquivo já abre na prévia do app.

## Validação

- Confira a linha `OK ...` no stdout e o tamanho do arquivo.
- Abra a planilha na prévia do painel de artefatos para conferir abas e valores.
- Em erro, corrija o spec; não edite o script da skill.
