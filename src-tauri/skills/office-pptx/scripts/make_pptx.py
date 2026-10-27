#!/usr/bin/env python3
"""Generate a PowerPoint presentation (.pptx) using only the standard library.

A .pptx is an OOXML package (ZIP + XML). This script builds a minimal valid
package from scratch — presentation, slide master, two layouts, theme, slides,
notes slides, notes master, relationships, content types and properties —
without depending on `python-pptx`/`pip`.

Usage:
    python make_pptx.py --spec spec.json --out presentation.pptx

Spec format (JSON):
    {
      "title": "Q3 2026 Results",
      "subtitle": "Executive presentation",
      "slides": [
        {"title": "Key figures",
         "bullets": ["Revenue: $4.82M (+18% QoQ)", "New customers: 27"],
         "notes": "Mention the gross margin at the end."}
      ]
    }

- The cover slide is generated from `title`/`subtitle` (when present).
- Every entry in `slides` becomes a title + bullets slide.
- `notes` (optional) becomes the speaker notes slide.
- Bullets also accept `{"text": "...", "level": 1}` for nested levels.

Output: exit code 0 and one `OK <path> <bytes>` line on stdout on success;
exit code 1 and the error message on stderr on failure.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import sys
import zipfile
from datetime import datetime, timezone

REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
P_NS = "http://schemas.openxmlformats.org/presentationml/2006/main"
CP_NS = "http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
DC_NS = "http://purl.org/dc/elements/1.1/"
DCTERMS_NS = "http://purl.org/dc/terms/"
DCMITYPE_NS = "http://purl.org/dc/dcmitype/"
XSI_NS = "http://www.w3.org/2001/XMLSchema-instance"
EP_NS = "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"

SLIDE_CX = 12_192_000  # 16:9, 13.333 x 7.5 in, in EMU
SLIDE_CY = 6_858_000
MAX_SLIDES = 200
MAX_TEXT_CHARS = 100_000

GROUP_PROPS = (
    "<p:nvGrpSpPr><p:cNvPr id=\"1\" name=\"\"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>"
    "<p:grpSpPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"0\" cy=\"0\"/>"
    "<a:chOff x=\"0\" y=\"0\"/><a:chExt cx=\"0\" cy=\"0\"/></a:xfrm></p:grpSpPr>"
)

CLR_MAP = (
    "<p:clrMap bg1=\"lt1\" tx1=\"dk1\" bg2=\"lt2\" tx2=\"dk2\" "
    "accent1=\"accent1\" accent2=\"accent2\" accent3=\"accent3\" "
    "accent4=\"accent4\" accent5=\"accent5\" accent6=\"accent6\" "
    "hlink=\"hlink\" folHlink=\"folHlink\"/>"
)


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


def as_text(value: object, where: str) -> str:
    if value is None:
        return ""
    if isinstance(value, (str, int, float, bool)):
        text = str(value)
        if len(text) > MAX_TEXT_CHARS:
            raise SpecError(f"{where}: text longer than {MAX_TEXT_CHARS} characters")
        return text
    raise SpecError(f"{where}: expected text, got {type(value).__name__}")


def text_run(text: str) -> str:
    return f'<a:r><a:rPr lang="pt-BR" dirty="0"/><a:t>{escape(text)}</a:t></a:r>'


def paragraph(text: str, level: int = 0, bullet: bool = True) -> str:
    ppr = f'<a:pPr lvl="{max(0, min(8, level))}">'
    if not bullet:
        ppr += "<a:buNone/>"
    ppr += "</a:pPr>"
    return f"<a:p>{ppr}{text_run(text)}</a:p>"


def plain_paragraph(text: str) -> str:
    return f"<a:p>{text_run(text)}</a:p>"


def placeholder_shape(
    shape_id: int,
    name: str,
    placeholder: str,
    x: int,
    y: int,
    cx: int,
    cy: int,
    paragraphs_xml: str,
    *,
    placeholder_attrs: str = "",
) -> str:
    return (
        f'<p:sp><p:nvSpPr><p:cNvPr id="{shape_id}" name="{escape(name)}"/>'
        "<p:cNvSpPr><a:spLocks noGrp=\"1\"/></p:cNvSpPr>"
        f'<p:nvPr><p:ph type="{placeholder}"{placeholder_attrs}/></p:nvPr></p:nvSpPr>'
        f'<p:spPr><a:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm>'
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>'
        '<p:txBody><a:bodyPr><a:normAutofit/></a:bodyPr><a:lstStyle/>'
        f"{paragraphs_xml}</p:txBody></p:sp>"
    )


def slide_tree(shapes: str) -> str:
    return (
        f"<p:spTree>{GROUP_PROPS}{shapes}</p:spTree>"
    )


# ---------------------------------------------------------------------------
# Slides
# ---------------------------------------------------------------------------


def multiline_paragraphs(text: str) -> str:
    """One `<a:p>` per line (titles/subtitles may contain `\\n`)."""
    lines = [line for line in text.splitlines() if line.strip()] or ([text] if text else [""])
    return "".join(plain_paragraph(line) for line in lines)


def cover_slide_xml(title: str, subtitle: str) -> str:
    shapes: list[str] = []
    if title:
        shapes.append(
            placeholder_shape(
                2,
                "Title 1",
                "ctrTitle",
                838_200,
                2_134_425,
                10_515_600,
                1_470_025,
                multiline_paragraphs(title),
            )
        )
    if subtitle:
        shapes.append(
            placeholder_shape(
                3,
                "Subtitle 2",
                "subTitle",
                1_371_600,
                3_886_200,
                9_448_800,
                1_752_600,
                multiline_paragraphs(subtitle),
                placeholder_attrs=' idx="1"',
            )
        )
    if not shapes:
        shapes.append(
            placeholder_shape(
                2,
                "Title 1",
                "ctrTitle",
                838_200,
                2_134_425,
                10_515_600,
                1_470_025,
                plain_paragraph(""),
            )
        )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<p:sld xmlns:a="{A_NS}" xmlns:r="{R_NS}" xmlns:p="{P_NS}">'
        f"<p:cSld>{slide_tree(''.join(shapes))}</p:cSld>"
        "<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>"
    )


def content_slide_xml(title: str, bullets: list[tuple[str, int]]) -> str:
    title_shape = placeholder_shape(
        2,
        "Title 1",
        "title",
        838_200,
        365_125,
        10_515_600,
        1_325_563,
        plain_paragraph(title),
    )
    paragraphs = "".join(paragraph(text, level) for text, level in bullets)
    if paragraphs == "":
        paragraphs = '<a:p><a:pPr lvl="0"/><a:endParaRPr lang="pt-BR"/></a:p>'
    body_shape = placeholder_shape(
        3,
        "Content Placeholder 2",
        "body",
        838_200,
        1_825_625,
        10_515_600,
        4_351_338,
        paragraphs,
        placeholder_attrs=' idx="1"',
    )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<p:sld xmlns:a="{A_NS}" xmlns:r="{R_NS}" xmlns:p="{P_NS}">'
        f"<p:cSld>{slide_tree(title_shape + body_shape)}</p:cSld>"
        "<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>"
    )


def notes_slide_xml(lines: list[str]) -> str:
    paragraphs = "".join(plain_paragraph(line) for line in lines)
    shapes = (
        '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/>'
        '<p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr>'
        '<p:nvPr><p:ph type="sldImg" idx="2"/></p:nvPr></p:nvSpPr><p:spPr/>'
        '<p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>'
        '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/>'
        '<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>'
        '<p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/>'
        f'<p:txBody><a:bodyPr/><a:lstStyle/>{paragraphs}</p:txBody></p:sp>'
    )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<p:notes xmlns:a="{A_NS}" xmlns:r="{R_NS}" xmlns:p="{P_NS}">'
        f"<p:cSld>{slide_tree(shapes)}</p:cSld>"
        "<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>"
    )


# ---------------------------------------------------------------------------
# Master, layouts, theme and notes master
# ---------------------------------------------------------------------------


def build_slide_master() -> str:
    title_shape = placeholder_shape(
        2,
        "Title Placeholder 1",
        "title",
        838_200,
        365_125,
        10_515_600,
        1_325_563,
        plain_paragraph("Slide title"),
    )
    body_shape = placeholder_shape(
        3,
        "Text Placeholder 2",
        "body",
        838_200,
        1_825_625,
        10_515_600,
        4_351_338,
        plain_paragraph("Slide text"),
        placeholder_attrs=' idx="1"',
    )
    tx_styles = (
        "<p:txStyles>"
        "<p:titleStyle><a:lvl1pPr algn=\"l\"><a:defRPr sz=\"4000\" b=\"1\">"
        '<a:solidFill><a:schemeClr val="tx1"/></a:solidFill>'
        '<a:latin typeface="+mj-lt"/><a:ea typeface="+mj-ea"/><a:cs typeface="+mj-cs"/>'
        "</a:defRPr></a:lvl1pPr></p:titleStyle>"
        "<p:bodyStyle><a:lvl1pPr marL=\"0\" indent=\"0\"><a:defRPr sz=\"2000\">"
        '<a:solidFill><a:schemeClr val="tx1"/></a:solidFill>'
        '<a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/>'
        "</a:defRPr></a:lvl1pPr></p:bodyStyle>"
        "<p:otherStyle><a:lvl1pPr marL=\"0\" indent=\"0\"><a:defRPr sz=\"1800\">"
        '<a:solidFill><a:schemeClr val="tx1"/></a:solidFill>'
        '<a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/>'
        "</a:defRPr></a:lvl1pPr></p:otherStyle>"
        "</p:txStyles>"
    )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<p:sldMaster xmlns:a="{A_NS}" xmlns:r="{R_NS}" xmlns:p="{P_NS}">'
        "<p:cSld><p:bg><p:bgRef idx=\"1001\"><a:schemeClr val=\"bg1\"/></p:bgRef></p:bg>"
        f"{slide_tree(title_shape + body_shape)}</p:cSld>"
        f"{CLR_MAP}"
        "<p:sldLayoutIdLst>"
        '<p:sldLayoutId id="2147483649" r:id="rId1"/>'
        '<p:sldLayoutId id="2147483650" r:id="rId2"/>'
        "</p:sldLayoutIdLst>"
        f"{tx_styles}</p:sldMaster>"
    )


def build_title_layout() -> str:
    shapes = (
        placeholder_shape(
            2,
            "Title 1",
            "ctrTitle",
            838_200,
            2_134_425,
            10_515_600,
            1_470_025,
            plain_paragraph("Cover title"),
        )
        + placeholder_shape(
            3,
            "Subtitle 2",
            "subTitle",
            1_371_600,
            3_886_200,
            9_448_800,
            1_752_600,
            plain_paragraph("Cover subtitle"),
            placeholder_attrs=' idx="1"',
        )
    )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<p:sldLayout xmlns:a="{A_NS}" xmlns:r="{R_NS}" xmlns:p="{P_NS}" '
        'type="title" preserve="1">'
        f'<p:cSld name="Cover">{slide_tree(shapes)}</p:cSld>'
        "<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>"
    )


def build_content_layout() -> str:
    shapes = (
        placeholder_shape(
            2,
            "Title 1",
            "title",
            838_200,
            365_125,
            10_515_600,
            1_325_563,
            plain_paragraph("Slide title"),
        )
        + placeholder_shape(
            3,
            "Content Placeholder 2",
            "body",
            838_200,
            1_825_625,
            10_515_600,
            4_351_338,
            plain_paragraph("Slide content"),
            placeholder_attrs=' idx="1"',
        )
    )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<p:sldLayout xmlns:a="{A_NS}" xmlns:r="{R_NS}" xmlns:p="{P_NS}" '
        'type="obj" preserve="1">'
        f'<p:cSld name="Title and Content">{slide_tree(shapes)}</p:cSld>'
        "<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>"
    )


def build_notes_master() -> str:
    shapes = (
        '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/>'
        '<p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr>'
        '<p:nvPr><p:ph type="sldImg" idx="2"/></p:nvPr></p:nvSpPr>'
        '<p:spPr><a:xfrm><a:off x="685800" y="1143000"/>'
        '<a:ext cx="5486400" cy="3086100"/></a:xfrm>'
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>'
        '<p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>'
        '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/>'
        '<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>'
        '<p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>'
        '<p:spPr><a:xfrm><a:off x="685800" y="4400550"/>'
        '<a:ext cx="5486400" cy="3600450"/></a:xfrm>'
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>'
        '<p:txBody><a:bodyPr/><a:lstStyle/>'
        f"{plain_paragraph('Speaker notes')}</p:txBody></p:sp>"
    )
    notes_style = (
        '<p:notesStyle><a:lvl1pPr marL="0" algn="l" defTabSz="914400" rtl="0" '
        'eaLnBrk="1" latinLnBrk="0" hangingPunct="1">'
        '<a:defRPr sz="1200" kern="1200">'
        '<a:solidFill><a:schemeClr val="tx1"/></a:solidFill>'
        '<a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/>'
        "</a:defRPr></a:lvl1pPr></p:notesStyle>"
    )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<p:notesMaster xmlns:a="{A_NS}" xmlns:r="{R_NS}" xmlns:p="{P_NS}">'
        '<p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>'
        f"{slide_tree(shapes)}</p:cSld>"
        f"{CLR_MAP}{notes_style}</p:notesMaster>"
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


# ---------------------------------------------------------------------------
# Relationships and package parts
# ---------------------------------------------------------------------------


def rels(items: list[tuple[str, str, str]]) -> str:
    """`items` = [(rId, type, target)]."""
    body = "".join(
        f'<Relationship Id="{identifier}" Type="{rel_type}" Target="{target}"/>'
        for identifier, rel_type, target in items
    )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<Relationships xmlns="{REL_NS}">{body}</Relationships>'
    )


def build_presentation(slide_count: int) -> str:
    slide_ids = "".join(
        f'<p:sldId id="{256 + index}" r:id="rId{4 + index}"/>'
        for index in range(slide_count)
    )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<p:presentation xmlns:a="{A_NS}" xmlns:r="{R_NS}" xmlns:p="{P_NS}" '
        'saveSubsetFonts="1" autoCompressPictures="0">'
        '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>'
        '<p:notesMasterIdLst><p:notesMasterId r:id="rId3"/></p:notesMasterIdLst>'
        f"<p:sldIdLst>{slide_ids}</p:sldIdLst>"
        f'<p:sldSz cx="{SLIDE_CX}" cy="{SLIDE_CY}" type="screen16x9"/>'
        '<p:notesSz cx="6858000" cy="9144000"/>'
        "</p:presentation>"
    )


def build_presentation_rels(slide_count: int) -> str:
    items: list[tuple[str, str, str]] = [
        ("rId1", f"{R_NS}/slideMaster", "slideMasters/slideMaster1.xml"),
        ("rId2", f"{R_NS}/theme", "theme/theme1.xml"),
        ("rId3", f"{R_NS}/notesMaster", "notesMasters/notesMaster1.xml"),
    ]
    for index in range(slide_count):
        items.append(
            (f"rId{4 + index}", f"{R_NS}/slide", f"slides/slide{index + 1}.xml")
        )
    return rels(items)


def build_content_types(slide_count: int, notes_numbers: list[int]) -> str:
    overrides = [
        ("/docProps/core.xml", "application/vnd.openxmlformats-package.core-properties+xml"),
        ("/docProps/app.xml", "application/vnd.openxmlformats-officedocument.extended-properties+xml"),
        ("/ppt/presentation.xml", "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"),
        ("/ppt/slideMasters/slideMaster1.xml", "application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"),
        ("/ppt/slideLayouts/slideLayout1.xml", "application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"),
        ("/ppt/slideLayouts/slideLayout2.xml", "application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"),
        ("/ppt/theme/theme1.xml", "application/vnd.openxmlformats-officedocument.theme+xml"),
        ("/ppt/notesMasters/notesMaster1.xml", "application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"),
    ]
    for index in range(slide_count):
        overrides.append(
            (
                f"/ppt/slides/slide{index + 1}.xml",
                "application/vnd.openxmlformats-officedocument.presentationml.slide+xml",
            )
        )
    for number in notes_numbers:
        overrides.append(
            (
                f"/ppt/notesSlides/notesSlide{number}.xml",
                "application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml",
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
    return rels(
        [
            ("rId1", f"{R_NS}/officeDocument", "ppt/presentation.xml"),
            (
                "rId2",
                "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties",
                "docProps/core.xml",
            ),
            ("rId3", f"{R_NS}/extended-properties", "docProps/app.xml"),
        ]
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


def build_app(slide_count: int, notes_count: int) -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<Properties xmlns="{EP_NS}" '
        'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">'
        "<Application>Lumina</Application><PresentationFormat>Widescreen</PresentationFormat>"
        f"<Slides>{slide_count}</Slides><Notes>{notes_count}</Notes>"
        "<DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop>"
        "<LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc>"
        "<HyperlinksChanged>false</HyperlinksChanged><AppVersion>1.0</AppVersion>"
        "</Properties>"
    )


# ---------------------------------------------------------------------------
# Spec assembly
# ---------------------------------------------------------------------------


def load_deck(spec: dict) -> tuple[str, str, list[dict]]:
    if not isinstance(spec, dict):
        raise SpecError("the spec must be a JSON object")
    title = as_text(spec.get("title"), "title")
    subtitle = as_text(spec.get("subtitle"), "subtitle")
    slides_raw = spec.get("slides") or []
    if not isinstance(slides_raw, list):
        raise SpecError("'slides' must be a list")
    if len(slides_raw) > MAX_SLIDES:
        raise SpecError(f"'slides' has more than {MAX_SLIDES} items")

    slides: list[dict] = []
    for index, raw in enumerate(slides_raw):
        if not isinstance(raw, dict):
            raise SpecError(f"slides[{index}]: expected an object")
        slide_title = as_text(raw.get("title"), f"slides[{index}].title")
        bullets_raw = raw.get("bullets") or []
        if not isinstance(bullets_raw, list):
            raise SpecError(f"slides[{index}].bullets: expected a list")
        bullets: list[tuple[str, int]] = []
        for bullet_index, bullet in enumerate(bullets_raw):
            if isinstance(bullet, dict):
                bullet_text = as_text(
                    bullet.get("text"), f"slides[{index}].bullets[{bullet_index}].text"
                )
                try:
                    level = int(bullet.get("level", 0) or 0)
                except (TypeError, ValueError):
                    raise SpecError(
                        f"slides[{index}].bullets[{bullet_index}].level: must be an integer"
                    ) from None
            else:
                bullet_text = as_text(
                    bullet, f"slides[{index}].bullets[{bullet_index}]"
                )
                level = 0
            if bullet_text.strip() == "":
                continue
            bullets.append((bullet_text, max(0, min(8, level))))
        notes = as_text(raw.get("notes"), f"slides[{index}].notes").strip()
        slides.append({"title": slide_title, "bullets": bullets, "notes": notes})

    if not title and not subtitle and not slides:
        raise SpecError("empty spec: provide 'title'/'subtitle' or at least one slide")
    if len(slides) > MAX_SLIDES - 1:
        raise SpecError(f"presentation with more than {MAX_SLIDES} slides (counting the cover)")
    return title, subtitle, slides


def build_package(spec: dict) -> bytes:
    title, subtitle, slides = load_deck(spec)

    parts: list[tuple[str, str]] = [
        ("_rels/.rels", build_root_rels()),
        ("docProps/core.xml", build_core(title)),
        (
            "docProps/app.xml",
            build_app(len(slides) + (1 if (title or subtitle) else 0), 0),
        ),
        ("ppt/theme/theme1.xml", build_theme()),
        ("ppt/slideMasters/slideMaster1.xml", build_slide_master()),
        (
            "ppt/slideMasters/_rels/slideMaster1.xml.rels",
            rels(
                [
                    ("rId1", f"{R_NS}/slideLayout", "../slideLayouts/slideLayout1.xml"),
                    ("rId2", f"{R_NS}/slideLayout", "../slideLayouts/slideLayout2.xml"),
                    ("rId3", f"{R_NS}/theme", "../theme/theme1.xml"),
                ]
            ),
        ),
        ("ppt/slideLayouts/slideLayout1.xml", build_title_layout()),
        (
            "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
            rels([("rId1", f"{R_NS}/slideMaster", "../slideMasters/slideMaster1.xml")]),
        ),
        ("ppt/slideLayouts/slideLayout2.xml", build_content_layout()),
        (
            "ppt/slideLayouts/_rels/slideLayout2.xml.rels",
            rels([("rId1", f"{R_NS}/slideMaster", "../slideMasters/slideMaster1.xml")]),
        ),
        ("ppt/notesMasters/notesMaster1.xml", build_notes_master()),
        (
            "ppt/notesMasters/_rels/notesMaster1.xml.rels",
            rels([("rId1", f"{R_NS}/theme", "../theme/theme1.xml")]),
        ),
    ]

    slide_parts: list[tuple[str, str]] = []
    notes_numbers: list[int] = []
    slide_number = 0
    has_cover = bool(title or subtitle)
    if has_cover:
        slide_number += 1
        slide_parts.append(
            (f"ppt/slides/slide{slide_number}.xml", cover_slide_xml(title, subtitle))
        )
        slide_parts.append(
            (
                f"ppt/slides/_rels/slide{slide_number}.xml.rels",
                rels([("rId1", f"{R_NS}/slideLayout", "../slideLayouts/slideLayout1.xml")]),
            )
        )
    for slide in slides:
        slide_number += 1
        slide_parts.append(
            (
                f"ppt/slides/slide{slide_number}.xml",
                content_slide_xml(slide["title"], slide["bullets"]),
            )
        )
        slide_parts.append(
            (
                f"ppt/slides/_rels/slide{slide_number}.xml.rels",
                rels([("rId1", f"{R_NS}/slideLayout", "../slideLayouts/slideLayout2.xml")]),
            )
        )
        if slide["notes"]:
            # The notes file uses the slide number (notesSlideN ↔ slideN), which
            # is the convention read by the app preview.
            notes_numbers.append(slide_number)
            note_lines = [
                line for line in slide["notes"].splitlines() if line.strip()
            ] or [slide["notes"]]
            slide_parts.append(
                (
                    f"ppt/notesSlides/notesSlide{slide_number}.xml",
                    notes_slide_xml(note_lines),
                )
            )
            slide_parts.append(
                (
                    f"ppt/notesSlides/_rels/notesSlide{slide_number}.xml.rels",
                    rels(
                        [
                            ("rId1", f"{R_NS}/slide", f"../slides/slide{slide_number}.xml"),
                            ("rId2", f"{R_NS}/notesMaster", "../notesMasters/notesMaster1.xml"),
                        ]
                    ),
                )
            )

    parts = [
        (
            name,
            build_app(slide_number, len(notes_numbers))
            if name == "docProps/app.xml"
            else content,
        )
        for name, content in parts
    ]
    presentation = build_presentation(slide_number)
    parts.insert(
        0,
        ("[Content_Types].xml", build_content_types(slide_number, notes_numbers)),
    )
    parts.append(("ppt/presentation.xml", presentation))
    parts.append(("ppt/_rels/presentation.xml.rels", build_presentation_rels(slide_number)))
    parts.extend(slide_parts)

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name, content in parts:
            info = zipfile.ZipInfo(name, date_time=(2024, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, content.encode("utf-8"))
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
        prog="make_pptx.py",
        description=(
            "Generate a .pptx (OOXML) file from a JSON spec, with no external "
            "dependencies."
        ),
    )
    parser.add_argument("--spec", required=True, help="path to spec.json")
    parser.add_argument("--out", required=True, help="path to the output .pptx")
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
