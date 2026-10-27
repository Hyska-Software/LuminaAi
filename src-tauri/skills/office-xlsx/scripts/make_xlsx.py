#!/usr/bin/env python3
"""Generate an Excel spreadsheet (.xlsx) using only the Python standard library.

A .xlsx is an OOXML package (ZIP + XML). This script builds the complete package
from scratch — workbook, worksheets, styles, theme, properties and
relationships — without depending on `openpyxl`/`pip`.

Usage:
    python make_xlsx.py --spec spec.json --out sales.xlsx

Spec format (JSON):
    {
      "sheets": [
        {
          "name": "Sales",
          "rows": [
            ["Month", "Revenue"],
            ["July", 1410000],
            ["Total", "=SUM(B2:B3)"]
          ],
          "formats": {"B2": "#,##0", "B3": "#,##0"}
        }
      ]
    }

- `rows`: list of rows; each cell can be text, number, boolean or a formula
  (a string starting with `=`).
- The first row of every worksheet is treated as a header (bold).
- `formats` (optional): map of cell → number format code
  (`"#,##0"`, `"0.00"`, `"0%。"`, `"dd/mm/yyyy"`, ...).
- `widths` (optional): list of column widths or a `{"A": 20}` map.

Output: exit code 0 and one `OK <path> <bytes>` line on stdout on success;
exit code 1 and the error message on stderr on failure.
"""

from __future__ import annotations

import argparse
import ast
import io
import json
import operator
import os
import re
import sys
import zipfile
from datetime import datetime, timezone

REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
S_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
CP_NS = "http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
DC_NS = "http://purl.org/dc/elements/1.1/"
DCTERMS_NS = "http://purl.org/dc/terms/"
DCMITYPE_NS = "http://purl.org/dc/dcmitype/"
XSI_NS = "http://www.w3.org/2001/XMLSchema-instance"
EP_NS = "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"

MAX_SHEETS = 100
MAX_ROWS = 50_000
MAX_COLUMNS = 200
MAX_CELL_TEXT = 32_767

# Number format codes built into Excel (avoids custom entries).
BUILTIN_FORMATS = {
    "General": None,
    "0": 1,
    "0.00": 2,
    "#,##0": 3,
    "#,##0.00": 4,
    "0%": 9,
    "0.00%": 10,
    "0.00E+00": 11,
    "dd/mm/yyyy": 14,
    "dd/mm/yy": 14,
    "d/m/yyyy": 14,
    "mm-dd-yy": 14,
    "hh:mm": 20,
    "hh:mm:ss": 21,
    "dd/mm/yyyy hh:mm": 22,
    "@": 49,
}


class SpecError(ValueError):
    """Invalid spec: the message is shown to the agent."""


def escape(value: object) -> str:
    return (
        str(value)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def column_letter(index: int) -> str:
    """1 -> A, 26 -> Z, 27 -> AA."""
    letters = ""
    number = index
    while number > 0:
        number, remainder = divmod(number - 1, 26)
        letters = chr(ord("A") + remainder) + letters
    return letters


CELL_REF_RE = re.compile(r"^\$?([A-Z]{1,3})\$?([0-9]{1,7})$")


def parse_ref(ref: str) -> tuple[int, int] | None:
    match = CELL_REF_RE.match(ref.strip().upper())
    if not match:
        return None
    column = 0
    for char in match.group(1):
        column = column * 26 + (ord(char) - ord("A") + 1)
    return int(match.group(2)), column


def as_text_cell(value: object, where: str) -> str:
    if isinstance(value, bool):
        # Boolean display labels; only used to estimate column widths, so they are
        # kept as-is to keep the generated files identical.
        return "VERDADEIRO" if value else "FALSO"
    if isinstance(value, (int, float)):
        return repr(value)
    if isinstance(value, str):
        if len(value) > MAX_CELL_TEXT:
            raise SpecError(f"{where}: text longer than {MAX_CELL_TEXT} characters")
        return value
    raise SpecError(f"{where}: unsupported cell type ({type(value).__name__})")


def is_number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def sanitize_sheet_name(name: object, fallback: str) -> str:
    text = re.sub(r"[\\/*?:\[\]]", "-", str(name or "")).strip()
    text = text.strip("'")
    if not text:
        text = fallback
    return text[:31]


def unique_sheet_names(names: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for name in names:
        candidate = name
        suffix = 2
        while candidate.lower() in seen:
            suffix_text = f"-{suffix}"
            candidate = name[: 31 - len(suffix_text)] + suffix_text
            suffix += 1
        seen.add(candidate.lower())
        result.append(candidate)
    return result


# ---------------------------------------------------------------------------
# Formulas: evaluation of cached values (optional; the formula is always kept in
# the file). Covers only the simple subset used in reports.
# ---------------------------------------------------------------------------

FUNC_RE = re.compile(r"^([A-Za-zÀ-ÿ_][A-Za-z0-9À-ÿ_.]*)\((.*)\)$")


class FormulaEvaluator:
    def __init__(self) -> None:
        self.values: dict[tuple[int, int], float] = {}
        self.strings: dict[tuple[int, int], str] = {}

    def _range_values(self, start: tuple[int, int], end: tuple[int, int]) -> list[float]:
        row1, col1 = start
        row2, col2 = end
        top, bottom = min(row1, row2), max(row1, row2)
        left, right = min(col1, col2), max(col1, col2)
        if (bottom - top + 1) * (right - left + 1) > 1_000_000:
            raise ValueError("range too large")
        values: list[float] = []
        for row in range(top, bottom + 1):
            for col in range(left, right + 1):
                if (row, col) in self.values:
                    values.append(self.values[(row, col)])
        return values

    def _argument_values(self, argument: str) -> list[float]:
        argument = argument.strip()
        if not argument:
            return []
        if ":" in argument:
            start, _, end = argument.partition(":")
            start_ref = parse_ref(start)
            end_ref = parse_ref(end)
            if not start_ref or not end_ref:
                raise ValueError(f"invalid range: {argument}")
            return self._range_values(start_ref, end_ref)
        reference = parse_ref(argument)
        if reference:
            if reference in self.values:
                return [self.values[reference]]
            return []
        try:
            return [float(argument.replace(",", "."))]
        except ValueError as error:
            raise ValueError(f"invalid argument: {argument}") from error

    def evaluate(self, formula: str) -> float | None:
        """Return the cached numeric value, or None when it cannot be computed."""
        expression = formula[1:] if formula.startswith("=") else formula
        expression = expression.strip().rstrip(";")
        if not expression:
            return None
        match = FUNC_RE.match(expression)
        try:
            if match:
                function = match.group(1).upper()
                arguments = [
                    part for part in re.split(r"[,;]", match.group(2)) if part.strip()
                ]
                values = [value for argument in arguments for value in self._argument_values(argument)]
                # pt-BR function aliases are kept for compatibility with existing
                # formulas; accented names are escaped so this source stays ASCII.
                if function in {"SUM", "SOMA"}:
                    return float(sum(values))
                if function in {"AVERAGE", "MEDIA", "M\u00c9DIA"}:
                    return float(sum(values) / len(values)) if values else None
                if function in {"MIN", "M\u00cdNIMO", "MINIMO"}:
                    return min(values) if values else None
                if function in {"MAX", "M\u00c1XIMO", "MAXIMO"}:
                    return max(values) if values else None
                if function in {"COUNT", "CONTAR", "CONT.N\u00daM", "CONT.NUM"}:
                    return float(len(values))
                return self._eval_arithmetic(expression)
            return self._eval_arithmetic(expression)
        except (ValueError, ZeroDivisionError, SyntaxError, TypeError):
            return None

    def _eval_arithmetic(self, expression: str) -> float:
        tree = ast.parse(expression, mode="eval")
        operations = {
            ast.Add: operator.add,
            ast.Sub: operator.sub,
            ast.Mult: operator.mul,
            ast.Div: operator.truediv,
            ast.Pow: operator.pow,
            ast.Mod: operator.mod,
            ast.USub: operator.neg,
            ast.UAdd: operator.pos,
        }

        def walk(node: ast.AST) -> float:
            if isinstance(node, ast.Expression):
                return walk(node.body)
            if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
                return float(node.value)
            if isinstance(node, ast.Name) and isinstance(node.id, str):
                reference = parse_ref(node.id)
                if reference is None:
                    raise ValueError(f"invalid reference: {node.id}")
                if reference not in self.values:
                    raise ValueError(f"empty cell: {node.id}")
                return self.values[reference]
            if isinstance(node, ast.BinOp) and type(node.op) in operations:
                return operations[type(node.op)](walk(node.left), walk(node.right))
            if isinstance(node, ast.UnaryOp) and type(node.op) in operations:
                return operations[type(node.op)](walk(node.operand))
            raise ValueError("expression not supported for a cached value")

        return float(walk(tree))


def compute_cached_values(rows: list[list[object]]) -> dict[tuple[int, int], float]:
    """Compute cached values for simple formulas, in reading order."""
    evaluator = FormulaEvaluator()
    cached: dict[tuple[int, int], float] = {}
    for row_index, row in enumerate(rows, start=1):
        for column_index, value in enumerate(row, start=1):
            if is_number(value):
                evaluator.values[(row_index, column_index)] = float(value)
            elif isinstance(value, str) and value.startswith("="):
                result = evaluator.evaluate(value)
                if result is not None:
                    cached[(row_index, column_index)] = result
                    evaluator.values[(row_index, column_index)] = result
    return cached


# ---------------------------------------------------------------------------
# Worksheet model
# ---------------------------------------------------------------------------


class SheetModel:
    def __init__(self, name: str, rows: list[list[object]], formats: dict[str, str], widths: list[float] | None) -> None:
        self.name = name
        self.rows = rows
        self.formats = formats
        self.widths = widths
        self.cached = compute_cached_values(rows)

    @property
    def last_row(self) -> int:
        for row_index in range(len(self.rows), 0, -1):
            if any(cell not in (None, "") for cell in self.rows[row_index - 1]):
                return row_index
        return 0

    @property
    def last_column(self) -> int:
        width = 0
        for row in self.rows:
            for column_index in range(len(row), 0, -1):
                if row[column_index - 1] not in (None, ""):
                    width = max(width, column_index)
                    break
        return width

    def column_width(self, column_index: int) -> float:
        if self.widths is not None and column_index - 1 < len(self.widths):
            return max(4.0, min(120.0, float(self.widths[column_index - 1])))
        length = len(column_letter(column_index)) + 2
        for row in self.rows[:500]:
            if column_index - 1 < len(row):
                value = row[column_index - 1]
                if value not in (None, ""):
                    length = max(length, len(as_text_cell(value, "cell")) + 2)
        return float(max(8, min(60, length)))


def load_sheets(spec: dict) -> list[SheetModel]:
    if not isinstance(spec, dict):
        raise SpecError("the spec must be a JSON object")
    raw_sheets = spec.get("sheets")
    if not isinstance(raw_sheets, list) or not raw_sheets:
        raise SpecError("'sheets' must be a non-empty list")
    if len(raw_sheets) > MAX_SHEETS:
        raise SpecError(f"'sheets' has more than {MAX_SHEETS} worksheets")

    names: list[str] = []
    for index, raw in enumerate(raw_sheets):
        if not isinstance(raw, dict):
            raise SpecError(f"sheets[{index}]: expected an object")
        names.append(sanitize_sheet_name(raw.get("name"), f"Sheet {index + 1}"))
    names = unique_sheet_names(names)

    sheets: list[SheetModel] = []
    for index, (raw, name) in enumerate(zip(raw_sheets, names)):
        rows_raw = raw.get("rows")
        if not isinstance(rows_raw, list):
            raise SpecError(f"sheets[{index}].rows: expected a list of rows")
        if len(rows_raw) > MAX_ROWS:
            raise SpecError(f"sheets[{index}].rows: more than {MAX_ROWS} rows")
        rows: list[list[object]] = []
        for row_index, row_raw in enumerate(rows_raw):
            if not isinstance(row_raw, list):
                raise SpecError(f"sheets[{index}].rows[{row_index}]: expected a list")
            if len(row_raw) > MAX_COLUMNS:
                raise SpecError(
                    f"sheets[{index}].rows[{row_index}]: more than {MAX_COLUMNS} columns"
                )
            for column_index, value in enumerate(row_raw):
                if value is not None and not isinstance(value, (str, int, float, bool)):
                    raise SpecError(
                        f"sheets[{index}].rows[{row_index}][{column_index}]: "
                        "use text, number, boolean or formula"
                    )
            rows.append(list(row_raw))

        formats_raw = raw.get("formats") or {}
        if not isinstance(formats_raw, dict):
            raise SpecError(f"sheets[{index}].formats: expected an object")
        formats: dict[str, str] = {}
        for reference, code in formats_raw.items():
            parsed = parse_ref(str(reference))
            if parsed is None:
                raise SpecError(
                    f"sheets[{index}].formats: invalid reference {reference!r} "
                    "(use something like \"B2\")"
                )
            if not isinstance(code, str) or not code.strip():
                raise SpecError(
                    f"sheets[{index}].formats[{reference!r}]: format must be text"
                )
            formats[f"{parsed[0]},{parsed[1]}"] = code.strip()

        widths: list[float] | None = None
        widths_raw = raw.get("widths")
        if isinstance(widths_raw, list):
            widths = []
            for width in widths_raw:
                try:
                    widths.append(float(width))
                except (TypeError, ValueError):
                    raise SpecError(
                        f"sheets[{index}].widths: widths must be numbers"
                    ) from None
        elif isinstance(widths_raw, dict):
            widths = []
            for reference, width in widths_raw.items():
                column = parse_ref(f"{reference}1")
                if column is None:
                    raise SpecError(
                        f"sheets[{index}].widths: invalid column {reference!r}"
                    )
                while len(widths) < column[1]:
                    widths.append(8.0)
                try:
                    widths[column[1] - 1] = float(width)
                except (TypeError, ValueError):
                    raise SpecError(
                        f"sheets[{index}].widths[{reference!r}]: width must be a number"
                    ) from None
        elif widths_raw is not None:
            raise SpecError(f"sheets[{index}].widths: use a list or an object")

        sheets.append(SheetModel(name, rows, formats, widths))
    return sheets


# ---------------------------------------------------------------------------
# Styles
# ---------------------------------------------------------------------------


class StyleBook:
    def __init__(self, sheets: list[SheetModel]) -> None:
        self.num_formats: list[str] = []
        self.xfs: list[dict[str, object]] = []
        self._xf_index: dict[tuple[bool, str | None], int] = {}
        # XF 0: default.
        self.xfs.append({"bold": False, "numfmt": None, "header": False})
        used: set[tuple[bool, str | None]] = set()
        for sheet in sheets:
            for row_index, row in enumerate(sheet.rows, start=1):
                for column_index, value in enumerate(row, start=1):
                    if value is None or value == "":
                        continue
                    bold = row_index == 1
                    code = sheet.formats.get(f"{row_index},{column_index}")
                    used.add((bold, code))
        for bold, code in sorted(used, key=lambda item: (item[0], item[1] or "")):
            if (bold, code) in self._xf_index:
                continue
            self._xf_index[(bold, code)] = len(self.xfs)
            self.xfs.append({"bold": bold, "numfmt": code, "header": bold})

    def xf_for(self, bold: bool, code: str | None) -> int:
        return self._xf_index.get((bold, code), 0)

    def numfmt_id(self, code: str | None) -> int | None:
        if code is None:
            return None
        if code in BUILTIN_FORMATS:
            return BUILTIN_FORMATS[code]
        if code not in self.num_formats:
            self.num_formats.append(code)
        return 164 + self.num_formats.index(code)

    def build(self) -> str:
        # Resolve every numFmtId first (the custom format list is filled on
        # demand), then generate the XML.
        resolved: list[tuple[int, int, int, dict[str, object]]] = []
        for xf in self.xfs:
            numfmt = self.numfmt_id(xf["numfmt"])  # type: ignore[arg-type]
            numfmt = 0 if numfmt is None else numfmt
            font_id = 1 if xf["bold"] else 0
            fill_id = 2 if xf["header"] else 0
            resolved.append((numfmt, font_id, fill_id, xf))
        num_formats = "".join(
            f'<numFmt numFmtId="{164 + index}" formatCode="{escape(code)}"/>'
            for index, code in enumerate(self.num_formats)
        )
        fonts = (
            '<fonts count="2">'
            '<font><sz val="11"/><color theme="1"/><name val="Calibri"/>'
            '<family val="2"/><scheme val="minor"/></font>'
            '<font><b/><sz val="11"/><color theme="1"/><name val="Calibri"/>'
            '<family val="2"/><scheme val="minor"/></font>'
            "</fonts>"
        )
        fills = (
            '<fills count="3">'
            '<fill><patternFill patternType="none"/></fill>'
            '<fill><patternFill patternType="gray125"/></fill>'
            '<fill><patternFill patternType="solid">'
            '<fgColor rgb="FFE8EEF9"/><bgColor indexed="64"/></patternFill></fill>'
            "</fills>"
        )
        borders = (
            '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
        )
        cell_style_xfs = (
            '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" '
            'borderId="0"/></cellStyleXfs>'
        )
        xf_parts: list[str] = []
        for numfmt, font_id, fill_id, xf in resolved:
            attributes = (
                f'numFmtId="{numfmt}" fontId="{font_id}" fillId="{fill_id}" borderId="0" '
                'xfId="0"'
            )
            inner = ""
            if xf["bold"]:
                inner += ' applyFont="1"'
            if xf["header"]:
                inner += ' applyFill="1" applyAlignment="1">'
                inner += '<alignment horizontal="center" vertical="center"/>'
            else:
                inner += ">"
            xf_parts.append(f"<xf {attributes}{inner}</xf>")
        cell_xfs = (
            f'<cellXfs count="{len(xf_parts)}">{"".join(xf_parts)}</cellXfs>'
        )
        return (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            f'<styleSheet xmlns="{S_NS}">'
            + (f'<numFmts count="{len(self.num_formats)}">{num_formats}</numFmts>' if self.num_formats else "")
            + fonts
            + fills
            + borders
            + cell_style_xfs
            + cell_xfs
            + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
            '<dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium2" '
            'defaultPivotStyle="PivotStyleLight16"/></styleSheet>'
        )


# ---------------------------------------------------------------------------
# Worksheet XML
# ---------------------------------------------------------------------------


def cell_xml(row_index: int, column_index: int, value: object, style: int, cached: dict[tuple[int, int], float]) -> str:
    reference = f"{column_letter(column_index)}{row_index}"
    style_attr = f' s="{style}"' if style else ""
    if value is None or value == "":
        if style:
            return f'<c r="{reference}"{style_attr}/>'
        return ""
    if isinstance(value, bool):
        return f'<c r="{reference}"{style_attr} t="b"><v>{1 if value else 0}</v></c>'
    if is_number(value):
        number = float(value)
        if number.is_integer() and abs(number) < 1e15:
            text = str(int(number))
        else:
            text = repr(number)
        return f'<c r="{reference}"{style_attr}><v>{text}</v></c>'
    text = str(value)
    if text.startswith("="):
        formula = escape(text[1:])
        cached_value = cached.get((row_index, column_index))
        if cached_value is None:
            return f'<c r="{reference}"{style_attr}><f>{formula}</f></c>'
        if float(cached_value).is_integer() and abs(cached_value) < 1e15:
            cached_text = str(int(cached_value))
        else:
            cached_text = repr(cached_value)
        return (
            f'<c r="{reference}"{style_attr}><f>{formula}</f>'
            f"<v>{cached_text}</v></c>"
        )
    preserve = ' xml:space="preserve"' if text != text.strip() else ""
    return f'<c r="{reference}"{style_attr} t="inlineStr"><is><t{preserve}>{escape(text)}</t></is></c>'


def sheet_xml(sheet: SheetModel, styles: StyleBook, selected: bool) -> str:
    last_row = max(1, sheet.last_row)
    last_column = max(1, sheet.last_column)
    dimension = f"A1:{column_letter(last_column)}{last_row}"

    columns_parts: list[str] = []
    for column_index in range(1, last_column + 1):
        width = sheet.column_width(column_index)
        columns_parts.append(
            f'<col min="{column_index}" max="{column_index}" width="{width:.2f}" customWidth="1"/>'
        )
    columns = f"<cols>{''.join(columns_parts)}</cols>" if columns_parts else ""

    rows_parts: list[str] = []
    for row_index, row in enumerate(sheet.rows[:last_row], start=1):
        cells: list[str] = []
        for column_index, value in enumerate(row, start=1):
            bold = row_index == 1
            code = sheet.formats.get(f"{row_index},{column_index}")
            style = styles.xf_for(bold, code)
            cells.append(cell_xml(row_index, column_index, value, style, sheet.cached))
        row_content = "".join(cells)
        if row_content:
            rows_parts.append(f'<row r="{row_index}">{row_content}</row>')
        else:
            rows_parts.append(f'<row r="{row_index}"/>')

    tab_selected = ' tabSelected="1"' if selected else ""
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<worksheet xmlns="{S_NS}" xmlns:r="{R_NS}">'
        f'<dimension ref="{dimension}"/>'
        f'<sheetViews><sheetView workbookViewId="0"{tab_selected}>'
        '<selection activeCell="A1" sqref="A1"/></sheetView></sheetViews>'
        '<sheetFormatPr defaultRowHeight="15"/>'
        f"{columns}"
        f'<sheetData>{"".join(rows_parts)}</sheetData>'
        '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>'
        "</worksheet>"
    )


# ---------------------------------------------------------------------------
# Remaining package parts
# ---------------------------------------------------------------------------


def build_theme() -> str:
    accents = ["2563EB", "7C3AED", "0D9488", "D97706", "DC2626", "4B5563"]
    accent_xml = "".join(
        f'<a:accent{index}><a:srgbClr val="{color}"/></a:accent{index}>'
        for index, color in enumerate(accents, start=1)
    )
    ln = (
        '<a:ln w="6350" cap="flat" cmpd="sng" algn="ctr">'
        '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
        '<a:prstDash val="solid"/></a:ln>'
    )
    solid = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<a:theme xmlns:a="{A_NS}" name="Lumina"><a:themeElements>'
        '<a:clrScheme name="Lumina">'
        '<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>'
        '<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>'
        '<a:dk2><a:srgbClr val="1F2937"/></a:dk2>'
        '<a:lt2><a:srgbClr val="F3F4F6"/></a:lt2>'
        f"{accent_xml}"
        '<a:hlink><a:srgbClr val="1D4ED8"/></a:hlink>'
        '<a:folHlink><a:srgbClr val="7C3AED"/></a:folHlink>'
        "</a:clrScheme>"
        '<a:fontScheme name="Lumina">'
        '<a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>'
        '<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>'
        "</a:fontScheme>"
        '<a:fmtScheme name="Lumina">'
        f"<a:fillStyleLst>{solid}{solid}{solid}</a:fillStyleLst>"
        f"<a:lnStyleLst>{ln}{ln}{ln}</a:lnStyleLst>"
        "<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle>"
        "<a:effectStyle><a:effectLst/></a:effectStyle>"
        "<a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>"
        f"<a:bgFillStyleLst>{solid}{solid}{solid}</a:bgFillStyleLst>"
        "</a:fmtScheme>"
        "</a:themeElements>"
        "<a:objectDefaults/><a:extraClrSchemeLst/></a:theme>"
    )


def build_workbook(sheets: list[SheetModel], has_theme: bool) -> str:
    sheet_parts = "".join(
        f'<sheet name="{escape(sheet.name)}" sheetId="{index + 1}" r:id="rId{index + 1}"/>'
        for index, sheet in enumerate(sheets)
    )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<workbook xmlns="{S_NS}" xmlns:r="{R_NS}">'
        '<workbookPr date1904="false" defaultThemeVersion="166925"/>'
        f"<sheets>{sheet_parts}</sheets>"
        '<calcPr calcId="191029" fullCalcOnLoad="1"/>'
        "</workbook>"
    )


def build_workbook_rels(sheets: list[SheetModel], has_theme: bool) -> str:
    rels: list[str] = []
    for index in range(len(sheets)):
        rels.append(
            f'<Relationship Id="rId{index + 1}" Type="{R_NS}/worksheet" '
            f'Target="worksheets/sheet{index + 1}.xml"/>'
        )
    rels.append(
        f'<Relationship Id="rId{len(sheets) + 1}" Type="{R_NS}/styles" Target="styles.xml"/>'
    )
    if has_theme:
        rels.append(
            f'<Relationship Id="rId{len(sheets) + 2}" Type="{R_NS}/theme" Target="theme/theme1.xml"/>'
        )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<Relationships xmlns="{REL_NS}">{"".join(rels)}</Relationships>'
    )


def build_content_types(sheets: list[SheetModel], has_theme: bool) -> str:
    overrides = [
        ("/xl/workbook.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"),
        ("/xl/styles.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"),
        ("/docProps/core.xml", "application/vnd.openxmlformats-package.core-properties+xml"),
        ("/docProps/app.xml", "application/vnd.openxmlformats-officedocument.extended-properties+xml"),
    ]
    for index in range(len(sheets)):
        overrides.append(
            (
                f"/xl/worksheets/sheet{index + 1}.xml",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml",
            )
        )
    if has_theme:
        overrides.append(
            ("/xl/theme/theme1.xml", "application/vnd.openxmlformats-officedocument.theme+xml")
        )
    override_xml = "".join(
        f'<Override PartName="{name}" ContentType="{content_type}"/>'
        for name, content_type in overrides
    )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<Types xmlns="{CT_NS}">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        f"{override_xml}</Types>"
    )


def build_root_rels() -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<Relationships xmlns="{REL_NS}">'
        f'<Relationship Id="rId1" Type="{R_NS}/officeDocument" Target="xl/workbook.xml"/>'
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
        f'<Relationship Id="rId3" Type="{R_NS}/extended-properties" Target="docProps/app.xml"/>'
        "</Relationships>"
    )


def build_core(title: str) -> str:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<cp:coreProperties xmlns:cp="{CP_NS}" xmlns:dc="{DC_NS}" '
        f'xmlns:dcterms="{DCTERMS_NS}" xmlns:dcmitype="{DCMITYPE_NS}" xmlns:xsi="{XSI_NS}">'
        f"<dc:title>{escape(title)}</dc:title>"
        "<dc:creator>Lumina</dc:creator>"
        "<cp:lastModifiedBy>Lumina</cp:lastModifiedBy>"
        f'<dcterms:created xsi:type="dcterms:W3CDTF">{now}</dcterms:created>'
        f'<dcterms:modified xsi:type="dcterms:W3CDTF">{now}</dcterms:modified>'
        "</cp:coreProperties>"
    )


def build_app(sheets: list[SheetModel]) -> str:
    titles = "".join(
        f'<vt:lpstr>{escape(sheet.name)}</vt:lpstr>' for sheet in sheets
    )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<Properties xmlns="{EP_NS}" '
        'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">'
        "<Application>Lumina</Application><DocSecurity>0</DocSecurity>"
        "<ScaleCrop>false</ScaleCrop>"
        f'<HeadingPairs><vt:vector size="2" baseType="variant">'
        "<vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant>"
        f'<vt:variant><vt:i4>{len(sheets)}</vt:i4></vt:variant>'
        "</vt:vector></HeadingPairs>"
        f'<TitlesOfParts><vt:vector size="{len(sheets)}" baseType="lpstr">{titles}</vt:vector></TitlesOfParts>'
        "<LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc>"
        "<HyperlinksChanged>false</HyperlinksChanged><AppVersion>1.0</AppVersion>"
        "</Properties>"
    )


def build_package(spec: dict) -> bytes:
    sheets = load_sheets(spec)
    styles = StyleBook(sheets)
    title = str(spec.get("title") or (sheets[0].name if sheets else "Sheet"))
    has_theme = True

    parts: list[tuple[str, str | bytes]] = [
        ("[Content_Types].xml", build_content_types(sheets, has_theme)),
        ("_rels/.rels", build_root_rels()),
        ("docProps/core.xml", build_core(title)),
        ("docProps/app.xml", build_app(sheets)),
        ("xl/workbook.xml", build_workbook(sheets, has_theme)),
        ("xl/_rels/workbook.xml.rels", build_workbook_rels(sheets, has_theme)),
        ("xl/styles.xml", styles.build()),
    ]
    for index, sheet in enumerate(sheets):
        parts.append(
            (
                f"xl/worksheets/sheet{index + 1}.xml",
                sheet_xml(sheet, styles, selected=index == 0),
            )
        )
    if has_theme:
        parts.append(("xl/theme/theme1.xml", build_theme()))

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name, content in parts:
            data = content.encode("utf-8") if isinstance(content, str) else content
            info = zipfile.ZipInfo(name, date_time=(2024, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, data)
    return buffer.getvalue()


def load_spec(path: str) -> dict:
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except OSError as error:
        raise SpecError(f"could not read the spec {path!r}: {error}") from error
    except json.JSONDecodeError as error:
        raise SpecError(f"spec is not valid JSON: {error}") from error


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        prog="make_xlsx.py",
        description=(
            "Generate a .xlsx (OOXML) file from a JSON spec, with no external "
            "dependencies."
        ),
    )
    parser.add_argument("--spec", required=True, help="path to spec.json")
    parser.add_argument("--out", required=True, help="path to the output .xlsx")
    args = parser.parse_args(argv)

    try:
        spec = load_spec(args.spec)
        data = build_package(spec)
        out = os.path.abspath(args.out)
        directory = os.path.dirname(out)
        if directory:
            os.makedirs(directory, exist_ok=True)
        with open(out, "wb") as handle:
            handle.write(data)
        print(f"OK {out} {len(data)}")
        return 0
    except (SpecError, OSError, ValueError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
