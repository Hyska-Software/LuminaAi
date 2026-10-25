#!/usr/bin/env python3
"""Gera um PDF A4 usando somente a biblioteca padrão do Python.

Escreve os objetos PDF à mão (catálogo, páginas, fontes base-14 Helvetica,
streams de conteúdo com `/Length` correto e compactação Flate) e codifica o
texto em latin-1/WinAnsi, então acentos do português aparecem corretamente.

Uso:
    python make_pdf.py --spec spec.json --out relatorio.pdf

Formato do spec (JSON):
    {
      "title": "Relatório Trimestral",
      "subtitle": "Aurora Analytics — Q3 2026",
      "footer": "Confidencial",
      "blocks": [
        {"type": "heading", "level": 1, "text": "Destaques"},
        {"type": "paragraph", "text": "..."},
        {"type": "bullets", "items": ["...", "..."]},
        {"type": "table", "headers": ["..."], "rows": [["..."]]},
        {"type": "page_break"}
      ]
    }

Saída: exit code 0 e uma linha `OK <caminho> <bytes>` no stdout em caso de
sucesso; exit code 1 e a mensagem de erro no stderr em caso de falha.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import zlib
from datetime import datetime, timezone

# A4 em pontos PostScript (72 dpi).
PAGE_WIDTH = 595.28
PAGE_HEIGHT = 841.89
MARGIN_LEFT = 56.7
MARGIN_RIGHT = 56.7
MARGIN_TOP = 64.0
MARGIN_BOTTOM = 68.0
CONTENT_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT
FOOTER_BASELINE = PAGE_HEIGHT - 34.0

FONT_REGULAR = "F1"
FONT_BOLD = "F2"

TEXT_COLOR = (0.12, 0.15, 0.19)
MUTED_COLOR = (0.42, 0.45, 0.50)

MAX_BLOCKS = 5_000
MAX_TEXT_CHARS = 200_000

# Larguras AFM (milésimos de em) da Helvetica/Helvetica-Bold para ASCII.
REGULAR_WIDTHS = {
    " ": 278, "!": 278, '"': 355, "#": 556, "$": 556, "%": 889, "&": 667,
    "'": 191, "(": 333, ")": 333, "*": 389, "+": 584, ",": 278, "-": 333,
    ".": 278, "/": 278, "0": 556, "1": 556, "2": 556, "3": 556, "4": 556,
    "5": 556, "6": 556, "7": 556, "8": 556, "9": 556, ":": 278, ";": 278,
    "<": 584, "=": 584, ">": 584, "?": 556, "@": 1015, "A": 667, "B": 667,
    "C": 722, "D": 722, "E": 667, "F": 611, "G": 778, "H": 722, "I": 278,
    "J": 500, "K": 667, "L": 556, "M": 833, "N": 722, "O": 778, "P": 667,
    "Q": 778, "R": 722, "S": 667, "T": 611, "U": 722, "V": 667, "W": 944,
    "X": 667, "Y": 667, "Z": 611, "[": 278, "\\": 278, "]": 278, "^": 469,
    "_": 556, "`": 333, "a": 556, "b": 556, "c": 500, "d": 556, "e": 556,
    "f": 278, "g": 556, "h": 556, "i": 222, "j": 222, "k": 500, "l": 222,
    "m": 833, "n": 556, "o": 556, "p": 556, "q": 556, "r": 333, "s": 500,
    "t": 278, "u": 556, "v": 500, "w": 722, "x": 500, "y": 500, "z": 500,
    "{": 334, "|": 260, "}": 334, "~": 584, "\u2022": 350, "\u2013": 556,
    "\u2014": 1000, "\u2018": 222, "\u2019": 222, "\u201c": 333,
    "\u201d": 333, "\u2026": 1000, "\u00a0": 278,
}

BOLD_WIDTHS = {
    " ": 278, "!": 333, '"': 474, "#": 556, "$": 556, "%": 889, "&": 722,
    "'": 238, "(": 333, ")": 333, "*": 389, "+": 584, ",": 278, "-": 333,
    ".": 278, "/": 278, "0": 556, "1": 556, "2": 556, "3": 556, "4": 556,
    "5": 556, "6": 556, "7": 556, "8": 556, "9": 556, ":": 333, ";": 333,
    "<": 584, "=": 584, ">": 584, "?": 611, "@": 975, "A": 722, "B": 722,
    "C": 722, "D": 722, "E": 667, "F": 611, "G": 778, "H": 722, "I": 278,
    "J": 556, "K": 722, "L": 611, "M": 833, "N": 722, "O": 778, "P": 667,
    "Q": 778, "R": 722, "S": 667, "T": 611, "U": 722, "V": 667, "W": 944,
    "X": 667, "Y": 667, "Z": 611, "[": 333, "\\": 278, "]": 333, "^": 584,
    "_": 556, "`": 333, "a": 556, "b": 611, "c": 556, "d": 611, "e": 556,
    "f": 333, "g": 611, "h": 611, "i": 278, "j": 278, "k": 556, "l": 278,
    "m": 889, "n": 611, "o": 611, "p": 611, "q": 611, "r": 389, "s": 556,
    "t": 333, "u": 611, "v": 556, "w": 778, "x": 556, "y": 556, "z": 500,
    "{": 389, "|": 280, "}": 389, "~": 584, "\u2022": 350, "\u2013": 556,
    "\u2014": 1000, "\u2018": 278, "\u2019": 278, "\u201c": 500,
    "\u201d": 500, "\u2026": 1000, "\u00a0": 278,
}

# Acentos do português usam a largura da letra base.
ACCENT_BASE = {
    "á": "a", "à": "a", "â": "a", "ã": "a", "ä": "a", "å": "a",
    "é": "e", "è": "e", "ê": "e", "ë": "e",
    "í": "i", "ì": "i", "î": "i", "ï": "i",
    "ó": "o", "ò": "o", "ô": "o", "õ": "o", "ö": "o", "ø": "o",
    "ú": "u", "ù": "u", "û": "u", "ü": "u",
    "ç": "c", "ñ": "n", "ý": "y", "ÿ": "y", "ß": "s", "æ": "a", "œ": "o",
    "Á": "A", "À": "A", "Â": "A", "Ã": "A", "Ä": "A", "Å": "A",
    "É": "E", "È": "E", "Ê": "E", "Ë": "E",
    "Í": "I", "Ì": "I", "Î": "I", "Ï": "I",
    "Ó": "O", "Ò": "O", "Ô": "O", "Õ": "O", "Ö": "O", "Ø": "O",
    "Ú": "U", "Ù": "U", "Û": "U", "Ü": "U",
    "Ç": "C", "Ñ": "N", "Ý": "Y", "Æ": "A", "Œ": "O",
}


class SpecError(ValueError):
    """Spec inválido: a mensagem é mostrada ao agente."""


def as_text(value: object, where: str) -> str:
    if value is None:
        return ""
    if isinstance(value, (str, int, float, bool)):
        text = str(value)
        if len(text) > MAX_TEXT_CHARS:
            raise SpecError(f"{where}: texto maior que {MAX_TEXT_CHARS} caracteres")
        return text
    raise SpecError(f"{where}: esperado texto, recebido {type(value).__name__}")


def char_width(char: str, bold: bool) -> int:
    table = BOLD_WIDTHS if bold else REGULAR_WIDTHS
    width = table.get(char)
    if width is not None:
        return width
    base = ACCENT_BASE.get(char)
    if base is not None:
        return table.get(base, 556)
    return 556


def text_width(text: str, size: float, bold: bool) -> float:
    return sum(char_width(char, bold) for char in text) * size / 1000.0


def wrap_text(text: str, size: float, bold: bool, width: float) -> list[str]:
    """Quebra o texto em linhas que cabem na largura informada (palavra a palavra)."""
    lines: list[str] = []
    for raw_line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        if raw_line.strip() == "":
            lines.append("")
            continue
        words = raw_line.split(" ")
        current = ""
        for word in words:
            candidate = word if current == "" else current + " " + word
            if text_width(candidate, size, bold) <= width:
                current = candidate
                continue
            if current:
                lines.append(current)
            # Palavra sozinha maior que a linha: corta por caractere.
            if text_width(word, size, bold) <= width:
                current = word
                continue
            chunk = ""
            for char in word:
                if text_width(chunk + char, size, bold) <= width:
                    chunk += char
                else:
                    lines.append(chunk)
                    chunk = char
            current = chunk
        if current or not lines:
            lines.append(current)
    return lines or [""]


def pdf_escape(text: str) -> bytes:
    """Codifica em latin-1 (WinAnsi) e escapa para string literal PDF."""
    raw = text.encode("latin-1", errors="replace")
    return (
        raw.replace(b"\\", b"\\\\")
        .replace(b"(", b"\\(")
        .replace(b")", b"\\)")
        .replace(b"\n", b" ")
        .replace(b"\r", b" ")
    )


def color_operator(color: tuple[float, float, float]) -> bytes:
    return f"{color[0]:.3f} {color[1]:.3f} {color[2]:.3f} rg".encode("ascii")


def text_operator(
    x: float, y: float, text: str, size: float, *, bold: bool = False, color=TEXT_COLOR
) -> bytes:
    """Operadores PDF para desenhar uma linha de texto com origem no topo."""
    pdf_y = PAGE_HEIGHT - y
    font = FONT_BOLD if bold else FONT_REGULAR
    return (
        color_operator(color)
        + b" BT /"
        + font.encode("ascii")
        + f" {size:.2f} Tf {x:.2f} {pdf_y:.2f} Td ".encode("ascii")
        + b"("
        + pdf_escape(text)
        + b") Tj ET"
    )


class PageWriter:
    def __init__(self, footer_text: str) -> None:
        self.footer_text = footer_text.strip()
        self.pages: list[list[bytes]] = []
        self.ops: list[bytes] = []
        self.y = MARGIN_TOP
        self._new_page()

    def _new_page(self) -> None:
        if self.ops:
            self.pages.append(self.ops)
        self.ops = []
        self.y = MARGIN_TOP

    def new_page(self) -> None:
        self._new_page()

    @property
    def bottom_limit(self) -> float:
        return PAGE_HEIGHT - MARGIN_BOTTOM

    def ensure(self, height: float) -> None:
        if self.y + height > self.bottom_limit:
            self._new_page()

    def advance(self, height: float) -> None:
        self.y += height

    def rule(self, width: float = CONTENT_WIDTH, color=(0.80, 0.82, 0.86)) -> None:
        self.ensure(12)
        y = PAGE_HEIGHT - self.y
        self.ops.append(
            f"{color[0]:.3f} {color[1]:.3f} {color[2]:.3f} RG 0.6 w "
            f"{MARGIN_LEFT:.2f} {y:.2f} m {MARGIN_LEFT + width:.2f} {y:.2f} l S".encode(
                "ascii"
            )
        )
        self.y += 12

    def paragraph(
        self,
        text: str,
        size: float = 11.0,
        *,
        bold: bool = False,
        color=TEXT_COLOR,
        x_offset: float = 0.0,
        hanging: float = 0.0,
        leading: float | None = None,
        extra_before: float = 0.0,
    ) -> None:
        leading = leading if leading is not None else size * 1.42
        width = CONTENT_WIDTH - x_offset - hanging
        lines = wrap_text(text, size, bold, width)
        self.y += extra_before
        self.ensure(leading * min(len(lines), 2))
        for index, line in enumerate(lines):
            if self.y + leading > self.bottom_limit:
                self._new_page()
            x = MARGIN_LEFT + x_offset + (hanging if index > 0 else 0.0)
            self.ops.append(
                text_operator(x, self.y + size, line, size, bold=bold, color=color)
            )
            self.y += leading


HEADING_SIZES = {1: 20.0, 2: 16.0, 3: 13.5, 4: 12.0, 5: 11.0, 6: 10.5}


def render_blocks(writer: PageWriter, spec: dict) -> None:
    title = as_text(spec.get("title"), "title")
    subtitle = as_text(spec.get("subtitle"), "subtitle")
    if title:
        lines = wrap_text(title, 24.0, True, CONTENT_WIDTH)
        writer.ensure(30 * len(lines))
        for line in lines:
            writer.ops.append(
                text_operator(MARGIN_LEFT, writer.y + 24, line, 24.0, bold=True)
            )
            writer.y += 30
        writer.y += 4
    if subtitle:
        lines = wrap_text(subtitle, 12.5, False, CONTENT_WIDTH)
        writer.ensure(18 * len(lines))
        for line in lines:
            writer.ops.append(
                text_operator(
                    MARGIN_LEFT, writer.y + 12.5, line, 12.5, color=MUTED_COLOR
                )
            )
            writer.y += 18
        writer.y += 10
    if title or subtitle:
        writer.rule()
        writer.y += 6

    blocks = spec.get("blocks") or []
    if not isinstance(blocks, list):
        raise SpecError("'blocks' deve ser uma lista")
    if len(blocks) > MAX_BLOCKS:
        raise SpecError(f"'blocks' tem mais de {MAX_BLOCKS} itens")

    for index, block in enumerate(blocks):
        if not isinstance(block, dict):
            raise SpecError(f"blocks[{index}]: esperado um objeto")
        block_type = block.get("type")
        if block_type == "heading":
            try:
                level = int(block.get("level", 1))
            except (TypeError, ValueError):
                raise SpecError(f"blocks[{index}]: 'level' deve ser inteiro") from None
            level = max(1, min(6, level))
            size = HEADING_SIZES[level]
            text = as_text(block.get("text"), f"blocks[{index}].text")
            lines = wrap_text(text, size, True, CONTENT_WIDTH)
            writer.y += 18 if level <= 2 else 12
            writer.ensure(size * 1.3 * len(lines) + 6)
            for line in lines:
                writer.ops.append(
                    text_operator(MARGIN_LEFT, writer.y + size, line, size, bold=True)
                )
                writer.y += size * 1.3
            writer.y += 6
        elif block_type == "paragraph":
            writer.paragraph(
                as_text(block.get("text"), f"blocks[{index}].text"), extra_before=2
            )
        elif block_type == "bullets":
            items = block.get("items")
            if not isinstance(items, list):
                raise SpecError(f"blocks[{index}]: 'items' deve ser uma lista")
            if not items:
                raise SpecError(f"blocks[{index}]: lista de bullets vazia")
            for item_index, item in enumerate(items):
                level = 0
                if isinstance(item, dict):
                    level = int(item.get("level", 0) or 0)
                    item_text = as_text(
                        item.get("text"), f"blocks[{index}].items[{item_index}]"
                    )
                else:
                    item_text = as_text(
                        item, f"blocks[{index}].items[{item_index}]"
                    )
                level = max(0, min(4, level))
                marker = "\u2022" if level == 0 else "\u2013"
                indent = 14.0 + level * 14.0
                writer.paragraph(
                    marker + "  " + item_text,
                    x_offset=indent,
                    hanging=10.0,
                    leading=15.0,
                )
            writer.y += 4
        elif block_type == "table":
            render_table(writer, block, index)
        elif block_type == "page_break":
            writer.new_page()
        elif block_type in {"title", "subtitle"}:
            text = as_text(block.get("text"), f"blocks[{index}].text")
            size = 22.0 if block_type == "title" else 13.0
            writer.paragraph(text, size=size, bold=block_type == "title", extra_before=4)
        else:
            raise SpecError(
                f"blocks[{index}]: tipo de bloco desconhecido {block_type!r}; "
                "use heading, paragraph, bullets, table, page_break"
            )


def render_table(writer: PageWriter, block: dict, index: int) -> None:
    headers = block.get("headers") or []
    rows = block.get("rows") or []
    if not isinstance(headers, list) or not isinstance(rows, list):
        raise SpecError(f"blocks[{index}]: 'headers' e 'rows' devem ser listas")
    if not headers and not rows:
        raise SpecError(f"blocks[{index}]: tabela sem 'headers' nem 'rows'")
    normalized: list[list[str]] = []
    for row_index, row in enumerate(rows):
        if not isinstance(row, list):
            raise SpecError(f"blocks[{index}].rows[{row_index}]: esperada uma lista")
        normalized.append(
            [as_text(cell, f"blocks[{index}].rows[{row_index}]") for cell in row]
        )
    header_cells = [as_text(cell, f"blocks[{index}].headers") for cell in headers]
    columns = max([len(header_cells)] + [len(row) for row in normalized])
    if columns == 0:
        raise SpecError(f"blocks[{index}]: tabela sem colunas")
    if columns > 12:
        raise SpecError(f"blocks[{index}]: tabela com mais de 12 colunas (PDF)")
    column_width = CONTENT_WIDTH / columns
    size = 9.5
    leading = 12.0
    padding = 4.0

    def padded(cells: list[str]) -> list[str]:
        return cells + [""] * (columns - len(cells))

    def draw_row(cells: list[str], bold: bool) -> None:
        wrapped = [
            wrap_text(cell, size, bold, column_width - 2 * padding) for cell in cells
        ]
        height = max(len(lines) for lines in wrapped) * leading + 6
        writer.ensure(height)
        top = writer.y
        for column_index, lines in enumerate(wrapped):
            x = MARGIN_LEFT + column_index * column_width + padding
            for line_index, line in enumerate(lines):
                writer.ops.append(
                    text_operator(
                        x, top + 6 + line_index * leading + size, line, size, bold=bold
                    )
                )
        writer.y = top + height

    draw_row(padded(header_cells), True)
    if header_cells:
        y = PAGE_HEIGHT - writer.y
        writer.ops.append(
            f"0.75 0.78 0.82 RG 0.6 w {MARGIN_LEFT:.2f} {y:.2f} m "
            f"{MARGIN_LEFT + CONTENT_WIDTH:.2f} {y:.2f} l S".encode("ascii")
        )
    for row in normalized:
        draw_row(padded(row), False)
    writer.y += 8


def append_footers(writer: PageWriter) -> None:
    total = len(writer.pages)
    for index, ops in enumerate(writer.pages, start=1):
        y_baseline = PAGE_HEIGHT - FOOTER_BASELINE
        sep_y = y_baseline + 12
        ops.append(
            f"0.82 0.84 0.87 RG 0.6 w {MARGIN_LEFT:.2f} {sep_y:.2f} m "
            f"{MARGIN_LEFT + CONTENT_WIDTH:.2f} {sep_y:.2f} l S".encode("ascii")
        )
        if writer.footer_text:
            ops.append(
                text_operator(
                    MARGIN_LEFT,
                    FOOTER_BASELINE,
                    writer.footer_text,
                    8.5,
                    color=MUTED_COLOR,
                )
            )
        label = f"Página {index} de {total}"
        width = text_width(label, 8.5, False)
        ops.append(
            text_operator(
                MARGIN_LEFT + CONTENT_WIDTH - width,
                FOOTER_BASELINE,
                label,
                8.5,
                color=MUTED_COLOR,
            )
        )


def build_pdf(spec: dict) -> bytes:
    if not isinstance(spec, dict):
        raise SpecError("o spec deve ser um objeto JSON")
    footer_text = as_text(spec.get("footer"), "footer")
    writer = PageWriter(footer_text)
    render_blocks(writer, spec)
    writer.pages.append(writer.ops)
    append_footers(writer)

    objects: list[bytes] = []
    page_count = len(writer.pages)

    # 1: catálogo
    objects.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    # 2: árvore de páginas (preenchida depois de saber os ids)
    objects.append(b"")
    # 3/4: fontes base-14
    objects.append(
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica "
        b"/Encoding /WinAnsiEncoding >>"
    )
    objects.append(
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold "
        b"/Encoding /WinAnsiEncoding >>"
    )

    first_page_id = 5
    kids = " ".join(
        f"{first_page_id + index * 2} 0 R" for index in range(page_count)
    )
    objects[1] = (
        f"<< /Type /Pages /Kids [{kids}] /Count {page_count} >>".encode("ascii")
    )

    for index, ops in enumerate(writer.pages):
        page_id = first_page_id + index * 2
        content_id = page_id + 1
        content = b"\n".join(ops)
        compressed = zlib.compress(content, 9)
        objects.append(
            (
                f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PAGE_WIDTH:.2f} {PAGE_HEIGHT:.2f}] "
                f"/Contents {content_id} 0 R "
                f"/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> >>"
            ).encode("ascii")
        )
        objects.append(
            (
                f"<< /Length {len(compressed)} /Filter /FlateDecode >>\nstream\n"
            ).encode("ascii")
            + compressed
            + b"\nendstream"
        )

    now = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%SZ")
    title_literal = _pdf_literal(as_text(spec.get("title"), "title"))
    objects.append(
        (
            f"<< /Producer (Lumina) /Creator (Lumina) /Title "
            f"({title_literal}) /CreationDate (D:{now}) >>"
        ).encode("latin-1", errors="replace")
    )
    info_id = len(objects)

    output = bytearray()
    output += b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"
    offsets: list[int] = [0]
    for object_id, payload in enumerate(objects, start=1):
        offsets.append(len(output))
        output += f"{object_id} 0 obj\n".encode("ascii")
        output += payload
        output += b"\nendobj\n"

    xref_offset = len(output)
    output += f"xref\n0 {len(objects) + 1}\n".encode("ascii")
    output += b"0000000000 65535 f \n"
    for offset in offsets[1:]:
        output += f"{offset:010d} 00000 n \n".encode("ascii")
    output += (
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R /Info {info_id} 0 R >>\n"
        f"startxref\n{xref_offset}\n%%EOF\n"
    ).encode("ascii")
    return bytes(output)


def _pdf_literal(text: str) -> str:
    """Escapa texto para string literal PDF (documento ASCII)."""
    return (
        text.replace("\\", "\\\\")
        .replace("(", "\\(")
        .replace(")", "\\)")
        .encode("latin-1", errors="replace")
        .decode("latin-1")
    )


def load_spec(path: str) -> dict:
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except OSError as error:
        raise SpecError(f"não foi possível ler o spec {path!r}: {error}") from error
    except json.JSONDecodeError as error:
        raise SpecError(f"spec não é JSON válido: {error}") from error


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        prog="make_pdf.py",
        description="Gera um PDF A4 a partir de um spec JSON, sem dependências externas.",
    )
    parser.add_argument("--spec", required=True, help="caminho do spec.json")
    parser.add_argument("--out", required=True, help="caminho do .pdf de saída")
    args = parser.parse_args(argv)

    try:
        spec = load_spec(args.spec)
        data = build_pdf(spec)
        out = os.path.abspath(args.out)
        directory = os.path.dirname(out)
        if directory:
            os.makedirs(directory, exist_ok=True)
        with open(out, "wb") as handle:
            handle.write(data)
        print(f"OK {out} {len(data)}")
        return 0
    except (SpecError, OSError, ValueError) as error:
        print(f"ERRO: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
