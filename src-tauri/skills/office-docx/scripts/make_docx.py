#!/usr/bin/env python3
"""Generate a Word document (.docx) using only the Python standard library.

A .docx is an OOXML package (ZIP + XML). This script builds the complete package
from scratch — document, styles, numbering, theme, footer, properties and
relationships — so it does not depend on `python-docx`/`pip`.

Usage:
    python make_docx.py --spec spec.json --out report.docx

Spec format (JSON):
    {
      "title": "Quarterly Report",              # optional
      "subtitle": "Aurora Analytics — Q3 2026", # optional
      "footer": "Aurora Analytics",             # optional
      "blocks": [
        {"type": "heading", "level": 1, "text": "Highlights"},
        {"type": "paragraph", "text": "..."},
        {"type": "bullets", "items": ["...", "..."]},
        {"type": "table", "headers": ["Product", "Revenue"],
         "rows": [["Platform", "2,910,000"]]},
        {"type": "page_break"}
      ]
    }

Output: exit code 0 and one `OK <path> <bytes>` line on stdout on success;
exit code 1 and the error message on stderr on failure.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import zipfile
from datetime import datetime, timezone

# OOXML namespaces (WordprocessingML / relationships / package).
W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types"
A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
CP_NS = "http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
DC_NS = "http://purl.org/dc/elements/1.1/"
DCTERMS_NS = "http://purl.org/dc/terms/"
DCMITYPE_NS = "http://purl.org/dc/dcmitype/"
XSI_NS = "http://www.w3.org/2001/XMLSchema-instance"
EP_NS = "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"

# Spec sanity limits (not app limits; they only prevent absurd packages).
MAX_BLOCKS = 5_000
MAX_TEXT_CHARS = 200_000


class SpecError(ValueError):
    """Invalid spec: the message is shown to the agent."""


def escape(value: object) -> str:
    """Escape text for XML content/attribute values."""
    return (
        str(value)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def as_text(value: object, where: str) -> str:
    if value is None:
        return ""
    if isinstance(value, (str, int, float, bool)):
        text = str(value)
        if len(text) > MAX_TEXT_CHARS:
            raise SpecError(f"{where}: text longer than {MAX_TEXT_CHARS} characters")
        return text
    raise SpecError(f"{where}: expected text, got {type(value).__name__}")


def list_of_dicts(value: object, where: str) -> list:
    if value is None:
        return []
    if not isinstance(value, list):
        raise SpecError(f"{where}: expected a list")
    if len(value) > MAX_BLOCKS:
        raise SpecError(f"{where}: list longer than {MAX_BLOCKS} items")
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            raise SpecError(f"{where}[{index}]: expected an object")
    return value


def run(text: str, *, bold: bool = False, italic: bool = False, underline: bool = False) -> str:
    """A `w:r` run with optional formatting."""
    if text == "":
        return ""
    props = ""
    if bold:
        props += "<w:b/>"
    if italic:
        props += "<w:i/>"
    if underline:
        props += '<w:u w:val="single"/>'
    rpr = f"<w:rPr>{props}</w:rPr>" if props else ""
    return (
        f'<w:r>{rpr}<w:t xml:space="preserve">{escape(text)}</w:t></w:r>'
    )


def paragraph(
    text: str,
    *,
    style: str | None = None,
    bold: bool = False,
    num_id: int | None = None,
    ilvl: int = 0,
    page_break_before: bool = False,
) -> str:
    """A `w:p` paragraph with optional style/numbering."""
    ppr_parts: list[str] = []
    if style:
        ppr_parts.append(f'<w:pStyle w:val="{style}"/>')
    if num_id is not None:
        ppr_parts.append(
            f'<w:numPr><w:ilvl w:val="{ilvl}"/><w:numId w:val="{num_id}"/></w:numPr>'
        )
    if page_break_before:
        ppr_parts.append("<w:pageBreakBefore/>")
    ppr = f"<w:pPr>{''.join(ppr_parts)}</w:pPr>" if ppr_parts else ""
    body = run(text, bold=bold)
    if body == "":
        body = "<w:r/>"
    return f"<w:p>{ppr}{body}</w:p>"


def bullet_paragraph(text: str, ilvl: int) -> str:
    """Bulleted list item (uses the numbering generated in numbering.xml)."""
    return paragraph(text, style="ListParagraph", num_id=1, ilvl=ilvl)


def heading_paragraph(level: int, text: str) -> str:
    level = max(1, min(6, int(level)))
    return paragraph(text, style=f"Heading{level}")


def table_cell(text: str, *, header: bool = False, width: int = 3000) -> str:
    shading = '<w:shd w:val="clear" w:color="auto" w:fill="E8EEF9"/>' if header else ""
    content = (
        f"<w:p><w:pPr><w:spacing w:before=\"40\" w:after=\"40\"/></w:pPr>"
        f"{run(text, bold=header)}</w:p>"
    )
    return (
        f"<w:tc><w:tcPr><w:tcW w:w=\"{width}\" w:type=\"dxa\"/>{shading}</w:tcPr>"
        f"{content}</w:tc>"
    )


def table_xml(block: dict, index: int) -> str:
    headers = block.get("headers") or []
    rows = block.get("rows") or []
    if not isinstance(headers, list) or not isinstance(rows, list):
        raise SpecError(f"blocks[{index}]: 'headers' and 'rows' must be lists")
    if not headers and not rows:
        raise SpecError(f"blocks[{index}]: table without 'headers' or 'rows'")

    normalized_rows: list[list[str]] = []
    for row_index, row in enumerate(rows):
        if not isinstance(row, list):
            raise SpecError(f"blocks[{index}].rows[{row_index}]: expected a list")
        normalized_rows.append(
            [as_text(cell, f"blocks[{index}].rows[{row_index}]") for cell in row]
        )
    header_cells = [
        as_text(cell, f"blocks[{index}].headers") for cell in headers
    ]

    columns = max([len(header_cells)] + [len(row) for row in normalized_rows])
    if columns == 0:
        raise SpecError(f"blocks[{index}]: table without columns")
    if columns > 60:
        raise SpecError(f"blocks[{index}]: table with more than 60 columns")
    column_width = max(600, 9_000 // columns)

    def pad(cells: list[str]) -> list[str]:
        return cells + [""] * (columns - len(cells))

    parts = [
        '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/>'
        '<w:tblW w:w="0" w:type="auto"/>'
        '<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" '
        'w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/>'
        "</w:tblPr><w:tblGrid>"
    ]
    parts.extend(f'<w:gridCol w:w="{column_width}"/>' for _ in range(columns))
    parts.append("</w:tblGrid>")
    if header_cells:
        parts.append("<w:tr><w:trPr><w:tblHeader/></w:trPr>")
        parts.extend(
            table_cell(cell, header=True, width=column_width)
            for cell in pad(header_cells)
        )
        parts.append("</w:tr>")
    for row in normalized_rows:
        parts.append("<w:tr>")
        parts.extend(table_cell(cell, width=column_width) for cell in pad(row))
        parts.append("</w:tr>")
    parts.append("</w:tbl>")
    return "".join(parts)


def build_body(spec: dict) -> str:
    blocks = spec.get("blocks")
    if blocks is not None and not isinstance(blocks, list):
        raise SpecError("'blocks' must be a list")
    blocks = blocks or []
    if len(blocks) > MAX_BLOCKS:
        raise SpecError(f"'blocks' has more than {MAX_BLOCKS} items")

    body: list[str] = []
    title = as_text(spec.get("title"), "title")
    subtitle = as_text(spec.get("subtitle"), "subtitle")
    if title:
        body.append(paragraph(title, style="Title"))
    if subtitle:
        body.append(paragraph(subtitle, style="Subtitle"))
    if title or subtitle:
        # Breathing room between the document header and the first block.
        body.append(paragraph("", style="Normal"))

    for index, block in enumerate(blocks):
        block_type = block.get("type")
        if block_type == "heading":
            level = block.get("level", 1)
            try:
                level = int(level)
            except (TypeError, ValueError):
                raise SpecError(f"blocks[{index}]: 'level' must be an integer") from None
            body.append(heading_paragraph(level, as_text(block.get("text"), f"blocks[{index}].text")))
        elif block_type == "paragraph":
            body.append(paragraph(as_text(block.get("text"), f"blocks[{index}].text")))
        elif block_type == "bullets":
            items = block.get("items")
            if not isinstance(items, list):
                raise SpecError(f"blocks[{index}]: 'items' must be a list")
            if not items:
                raise SpecError(f"blocks[{index}]: empty bullets list")
            for item_index, item in enumerate(items):
                ilvl = 0
                if isinstance(item, dict):
                    ilvl = int(item.get("level", 0) or 0)
                    item_text = as_text(
                        item.get("text"), f"blocks[{index}].items[{item_index}]"
                    )
                else:
                    item_text = as_text(item, f"blocks[{index}].items[{item_index}]")
                body.append(bullet_paragraph(item_text, max(0, min(8, ilvl))))
        elif block_type == "table":
            body.append(table_xml(block, index))
            body.append(paragraph(""))
        elif block_type == "page_break":
            body.append('<w:p><w:r><w:br w:type="page"/></w:r></w:p>')
        elif block_type == "title":
            body.append(paragraph(as_text(block.get("text"), f"blocks[{index}].text"), style="Title"))
        elif block_type == "subtitle":
            body.append(paragraph(as_text(block.get("text"), f"blocks[{index}].text"), style="Subtitle"))
        else:
            raise SpecError(
                f"blocks[{index}]: unknown block type {block_type!r}; "
                "use heading, paragraph, bullets, table, page_break"
            )

    if not body:
        body.append(paragraph(""))

    footer = as_text(spec.get("footer"), "footer")
    section = (
        "<w:sectPr>"
        + (
            '<w:footerReference w:type="default" r:id="rId4"/>'
            if footer
            else ""
        )
        + '<w:pgSz w:w="11906" w:h="16838"/>'
        '<w:pgMar w:top="1418" w:right="1418" w:bottom="1418" w:left="1418" '
        'w:header="708" w:footer="708" w:gutter="0"/>'
        '<w:cols w:space="708"/><w:docGrid w:linePitch="360"/>'
        "</w:sectPr>"
    )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<w:document xmlns:w="{W_NS}" xmlns:r="{R_NS}">'
        f"<w:body>{''.join(body)}{section}</w:body></w:document>"
    )


def build_footer(text: str) -> str:
    """Centered footer: optional text + "Page X of Y"."""
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<w:ftr xmlns:w="{W_NS}" xmlns:r="{R_NS}">'
        '<w:p><w:pPr><w:jc w:val="center"/>'
        '<w:pBdr><w:top w:val="single" w:sz="4" w:space="4" w:color="D1D5DB"/></w:pBdr>'
        "</w:pPr>"
        f'<w:r><w:t xml:space="preserve">{escape(text)}   ·   Page </w:t></w:r>'
        '<w:fldSimple w:instr=" PAGE "><w:r><w:t>1</w:t></w:r></w:fldSimple>'
        '<w:r><w:t xml:space="preserve"> of </w:t></w:r>'
        '<w:fldSimple w:instr=" NUMPAGES "><w:r><w:t>1</w:t></w:r></w:fldSimple>'
        "</w:p></w:ftr>"
    )


def build_styles() -> str:
    heading_sizes = {1: 36, 2: 30, 3: 26, 4: 24, 5: 22, 6: 22}
    heading_colors = {1: "111827", 2: "1F2937", 3: "374151", 4: "374151", 5: "4B5563", 6: "4B5563"}
    heading_before = {1: 360, 2: 300, 3: 260, 4: 240, 5: 220, 6: 200}
    styles: list[str] = [
        '<w:style w:type="paragraph" w:default="1" w:styleId="Normal">'
        '<w:name w:val="Normal"/><w:qFormat/>'
        '<w:pPr><w:spacing w:after="140" w:line="276" w:lineRule="auto"/></w:pPr>'
        '<w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>'
        '<w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:style>',
        '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/>'
        '<w:basedOn w:val="Normal"/><w:next w:val="Subtitle"/><w:qFormat/>'
        '<w:pPr><w:spacing w:before="240" w:after="80"/></w:pPr>'
        '<w:rPr><w:b/><w:color w:val="111827"/><w:sz w:val="52"/><w:szCs w:val="52"/></w:rPr>'
        "</w:style>",
        '<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/>'
        '<w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>'
        '<w:pPr><w:spacing w:after="320"/></w:pPr>'
        '<w:rPr><w:color w:val="6B7280"/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr>'
        "</w:style>",
    ]
    for level in range(1, 7):
        styles.append(
            f'<w:style w:type="paragraph" w:styleId="Heading{level}">'
            f'<w:name w:val="heading {level}"/><w:basedOn w:val="Normal"/>'
            '<w:next w:val="Normal"/><w:qFormat/>'
            f'<w:pPr><w:keepNext/><w:outlineLvl w:val="{level - 1}"/>'
            f'<w:spacing w:before="{heading_before[level]}" w:after="120"/></w:pPr>'
            f'<w:rPr><w:b/><w:color w:val="{heading_colors[level]}"/>'
            f'<w:sz w:val="{heading_sizes[level]}"/><w:szCs w:val="{heading_sizes[level]}"/></w:rPr>'
            "</w:style>"
        )
    styles.append(
        '<w:style w:type="paragraph" w:styleId="ListParagraph">'
        '<w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/>'
        '<w:pPr><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>'
    )
    styles.append(
        '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/>'
        "<w:tblPr><w:tblBorders>"
        '<w:top w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>'
        '<w:left w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>'
        '<w:bottom w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>'
        '<w:right w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>'
        '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>'
        '<w:insideV w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>'
        "</w:tblBorders></w:tblPr></w:style>"
    )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<w:styles xmlns:w="{W_NS}">'
        "<w:docDefaults><w:rPrDefault><w:rPr>"
        '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>'
        '<w:sz w:val="22"/><w:szCs w:val="22"/>'
        '<w:lang w:val="pt-BR" w:eastAsia="pt-BR" w:bidi="ar-SA"/>'
        "</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr>"
        '<w:spacing w:after="140" w:line="276" w:lineRule="auto"/>'
        "</w:pPr></w:pPrDefault></w:docDefaults>"
        f"{''.join(styles)}</w:styles>"
    )


def build_numbering() -> str:
    levels: list[str] = []
    bullet_and_indent = ["\u2022", "\u25e6", "\u25aa"]
    for level in range(9):
        char = bullet_and_indent[level % len(bullet_and_indent)]
        indent = 720 + level * 360
        levels.append(
            f'<w:lvl w:ilvl="{level}"><w:start w:val="1"/>'
            '<w:numFmt w:val="bullet"/>'
            f'<w:lvlText w:val="{char}"/><w:lvlJc w:val="left"/>'
            f'<w:pPr><w:ind w:left="{indent}" w:hanging="360"/></w:pPr>'
            '<w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:hint="default"/></w:rPr>'
            "</w:lvl>"
        )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<w:numbering xmlns:w="{W_NS}">'
        f'<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>'
        f"{''.join(levels)}</w:abstractNum>"
        '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>'
        "</w:numbering>"
    )


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


def build_content_types(has_footer: bool) -> str:
    overrides = [
        ("/word/document.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"),
        ("/word/styles.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"),
        ("/word/numbering.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"),
        ("/word/theme/theme1.xml", "application/vnd.openxmlformats-officedocument.theme+xml"),
        ("/docProps/core.xml", "application/vnd.openxmlformats-package.core-properties+xml"),
        ("/docProps/app.xml", "application/vnd.openxmlformats-officedocument.extended-properties+xml"),
    ]
    if has_footer:
        overrides.append(
            (
                "/word/footer1.xml",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml",
            )
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
        f'<Relationship Id="rId1" Type="{R_NS}/officeDocument" Target="word/document.xml"/>'
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
        f'<Relationship Id="rId3" Type="{R_NS}/extended-properties" Target="docProps/app.xml"/>'
        "</Relationships>"
    )


def build_document_rels(has_footer: bool) -> str:
    rels = [
        f'<Relationship Id="rId1" Type="{R_NS}/styles" Target="styles.xml"/>',
        f'<Relationship Id="rId2" Type="{R_NS}/numbering" Target="numbering.xml"/>',
        f'<Relationship Id="rId3" Type="{R_NS}/theme" Target="theme/theme1.xml"/>',
    ]
    if has_footer:
        rels.append(
            f'<Relationship Id="rId4" Type="{R_NS}/footer" Target="footer1.xml"/>'
        )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<Relationships xmlns="{REL_NS}">{"".join(rels)}</Relationships>'
    )


def build_core(title: str, subject: str) -> str:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<cp:coreProperties xmlns:cp="{CP_NS}" xmlns:dc="{DC_NS}" '
        f'xmlns:dcterms="{DCTERMS_NS}" xmlns:dcmitype="{DCMITYPE_NS}" xmlns:xsi="{XSI_NS}">'
        f"<dc:title>{escape(title)}</dc:title>"
        f"<dc:subject>{escape(subject)}</dc:subject>"
        "<dc:creator>Lumina</dc:creator>"
        "<cp:lastModifiedBy>Lumina</cp:lastModifiedBy>"
        f'<dcterms:created xsi:type="dcterms:W3CDTF">{now}</dcterms:created>'
        f'<dcterms:modified xsi:type="dcterms:W3CDTF">{now}</dcterms:modified>'
        "</cp:coreProperties>"
    )


def build_app() -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<Properties xmlns="{EP_NS}" '
        'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">'
        "<Application>Lumina</Application><DocSecurity>0</DocSecurity>"
        "<ScaleCrop>false</ScaleCrop><LinksUpToDate>false</LinksUpToDate>"
        "<SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged>"
        "<AppVersion>1.0</AppVersion></Properties>"
    )


def build_document(spec: dict) -> bytes:
    if not isinstance(spec, dict):
        raise SpecError("the spec must be a JSON object")
    has_footer = bool(str(spec.get("footer") or "").strip())
    parts: list[tuple[str, str | bytes]] = [
        ("[Content_Types].xml", build_content_types(has_footer)),
        ("_rels/.rels", build_root_rels()),
        ("docProps/core.xml", build_core(
            str(spec.get("title") or ""), str(spec.get("subtitle") or "")
        )),
        ("docProps/app.xml", build_app()),
        ("word/document.xml", build_body(spec)),
        ("word/_rels/document.xml.rels", build_document_rels(has_footer)),
        ("word/styles.xml", build_styles()),
        ("word/numbering.xml", build_numbering()),
        ("word/theme/theme1.xml", build_theme()),
    ]
    if has_footer:
        parts.append(("word/footer1.xml", build_footer(str(spec["footer"]))))

    import io

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
        prog="make_docx.py",
        description=(
            "Generate a .docx (OOXML) file from a JSON spec, with no external "
            "dependencies."
        ),
    )
    parser.add_argument("--spec", required=True, help="path to spec.json")
    parser.add_argument("--out", required=True, help="path to the output .docx")
    args = parser.parse_args(argv)

    try:
        spec = load_spec(args.spec)
        data = build_document(spec)
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
