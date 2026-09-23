"""ATS-safe PDF/DOCX rendering — see the ats-resume skill: one page, single
column, no images, real selectable text, and real clickable hyperlinks on
phone/email/LinkedIn/GitHub. Styling mirrors Tarun's original Overleaf
resume template (large centered name, section-heading rules, right-aligned
dates). The only table used is a single-row, two-cell borderless one per
item to right-align its dates against its title on one line — see the
ats-resume skill's note on why that's an accepted exception.

generate_pdf() guarantees one page: it renders at successively smaller
scales until the content fits, the same manual trick of shrinking fonts/
margins a person does in Overleaf to force a one-page fit. generate_docx()
takes the scale generate_pdf() settled on (python-docx/Word can't report
page counts, so it can't self-measure) so both outputs stay in sync."""

import io
import logging
import re
from pathlib import Path

from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import HRFlowable, Paragraph, SimpleDocTemplate, Table, TableStyle

from app.tailoring.schema import TailoredResumeContent

logger = logging.getLogger(__name__)

_BASE_MARGIN = 0.5 * inch
_MIN_MARGIN = 0.4 * inch
_SCALES = (1.0, 0.93, 0.87, 0.8, 0.74)

# Sections whose bullets render as plain lines (matches the original
# template: Summary is flowing prose, Skills lines are "Label: values"),
# everything else (Experience/Projects/Certifications/...) gets a dash.
_NO_DASH_SECTIONS = {"Summary", "Skills"}

_ITEM_ROW_STYLE = TableStyle(
    [
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]
)


def _normalize_url(url: str) -> str:
    return url if url.startswith(("http://", "https://")) else f"https://{url}"


def _link_label(url: str) -> str:
    if "linkedin.com" in url:
        return "LinkedIn"
    if "github.com" in url:
        return "GitHub"
    return url


def _tel_href(phone: str) -> str:
    digits = re.sub(r"[^\d+]", "", phone)
    return f"tel:{digits}"


def _styles(scale: float) -> dict[str, ParagraphStyle]:
    # Sizes track the actual point sizes of the Overleaf template this
    # mirrors (11pt document: \Huge name ~23pt, \large heading ~14pt,
    # \small body ~10pt) rather than a smaller guess — matching them keeps
    # the page filled down to the bottom margin instead of underfilled.
    s = scale
    return {
        "name": ParagraphStyle(
            "name", fontName="Times-Roman", fontSize=23 * s, alignment=TA_CENTER, spaceAfter=2, leading=25 * s
        ),
        "location": ParagraphStyle(
            "location", fontName="Times-Roman", fontSize=10 * s, alignment=TA_CENTER, spaceAfter=1, leading=12 * s
        ),
        "contact": ParagraphStyle(
            "contact", fontName="Times-Roman", fontSize=10 * s, alignment=TA_CENTER, spaceAfter=6 * s, leading=12 * s
        ),
        "heading": ParagraphStyle(
            "heading", fontName="Times-Bold", fontSize=13 * s, spaceBefore=9 * s, spaceAfter=2, leading=15 * s
        ),
        "item_title": ParagraphStyle("item_title", fontName="Times-Bold", fontSize=10 * s, leading=12.5 * s),
        "item_dates": ParagraphStyle(
            "item_dates", fontName="Times-Bold", fontSize=10 * s, leading=12.5 * s, alignment=TA_RIGHT
        ),
        "bullet": ParagraphStyle(
            "bullet", fontName="Times-Roman", fontSize=10 * s, leftIndent=12, spaceAfter=1.5 * s, leading=12.5 * s
        ),
        "plain": ParagraphStyle(
            "plain", fontName="Times-Roman", fontSize=10 * s, spaceAfter=2.5 * s, leading=12.5 * s
        ),
    }


def _contact_links_line(contact) -> str:
    bits = []
    if contact.phone:
        bits.append(f'<link href="{_tel_href(contact.phone)}"><u>{contact.phone}</u></link>')
    bits.append(f'<link href="mailto:{contact.email}"><u>{contact.email}</u></link>')
    for link in contact.links:
        url = _normalize_url(link)
        bits.append(f'<link href="{url}"><u>{_link_label(link)}</u></link>')
    return "&nbsp;&nbsp;&nbsp;".join(bits)


def _build_story(tailored: TailoredResumeContent, styles: dict, page_width: float) -> list:
    contact = tailored.contact
    story = [Paragraph(contact.name, styles["name"])]
    if contact.location:
        story.append(Paragraph(contact.location, styles["location"]))
    story.append(Paragraph(_contact_links_line(contact), styles["contact"]))

    for heading, items in tailored.sections():
        story.append(Paragraph(heading.upper(), styles["heading"]))
        story.append(HRFlowable(width="100%", thickness=0.6, color="black", spaceBefore=0, spaceAfter=2))
        dash = heading not in _NO_DASH_SECTIONS
        for item in items:
            if item.title:
                row = Table(
                    [[Paragraph(item.title, styles["item_title"]), Paragraph(item.dates or "", styles["item_dates"])]],
                    colWidths=[page_width * 0.7, page_width * 0.3],
                )
                row.setStyle(_ITEM_ROW_STYLE)
                story.append(row)
            elif item.dates:
                story.append(Paragraph(item.dates, styles["item_title"]))
            for bullet in item.bullets:
                text = f"&ndash; {bullet}" if dash else bullet
                story.append(Paragraph(text, styles["bullet"] if dash else styles["plain"]))
    return story


def generate_pdf(tailored: TailoredResumeContent, output_path: str) -> float:
    """Renders the PDF, shrinking scale/margins step by step until it fits
    one page. Returns the scale that was used, so generate_docx() can match it."""
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)

    buffer = io.BytesIO()
    pages = 0
    scale = _SCALES[-1]
    for scale in _SCALES:
        margin = max(_MIN_MARGIN, _BASE_MARGIN * (0.85 + 0.15 * scale))
        page_width = LETTER[0] - 2 * margin
        story = _build_story(tailored, _styles(scale), page_width)

        buffer = io.BytesIO()
        doc = SimpleDocTemplate(
            buffer,
            pagesize=LETTER,
            topMargin=margin,
            bottomMargin=margin,
            leftMargin=margin,
            rightMargin=margin,
            title=f"{tailored.contact.name} - Resume",
        )
        page_count = {"n": 0}

        def _count_pages(canvas, doc_, _pc=page_count):
            _pc["n"] += 1

        doc.build(story, onFirstPage=_count_pages, onLaterPages=_count_pages)
        pages = page_count["n"]
        if pages <= 1:
            break

    Path(output_path).write_bytes(buffer.getvalue())
    if pages > 1:
        logger.warning("Rendered PDF %s still spans %d pages at minimum scale", output_path, pages)
    return scale


def generate_docx(tailored: TailoredResumeContent, output_path: str, scale: float = 1.0) -> None:
    from docx import Document
    from docx.enum.table import WD_TABLE_ALIGNMENT
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.opc.constants import RELATIONSHIP_TYPE
    from docx.oxml.ns import qn
    from docx.oxml.shared import OxmlElement
    from docx.shared import Pt

    def add_hyperlink(paragraph, url: str, text: str) -> None:
        part = paragraph.part
        r_id = part.relate_to(url, RELATIONSHIP_TYPE.HYPERLINK, is_external=True)
        hyperlink = OxmlElement("w:hyperlink")
        hyperlink.set(qn("r:id"), r_id)
        run = OxmlElement("w:r")
        rpr = OxmlElement("w:rPr")
        color = OxmlElement("w:color")
        color.set(qn("w:val"), "0000EE")
        rpr.append(color)
        underline = OxmlElement("w:u")
        underline.set(qn("w:val"), "single")
        rpr.append(underline)
        run.append(rpr)
        text_el = OxmlElement("w:t")
        text_el.text = text
        run.append(text_el)
        hyperlink.append(run)
        paragraph._p.append(hyperlink)

    def add_bottom_border(paragraph) -> None:
        p_pr = paragraph._p.get_or_add_pPr()
        p_bdr = OxmlElement("w:pBdr")
        bottom = OxmlElement("w:bottom")
        bottom.set(qn("w:val"), "single")
        bottom.set(qn("w:sz"), "6")
        bottom.set(qn("w:space"), "2")
        bottom.set(qn("w:color"), "000000")
        p_bdr.append(bottom)
        p_pr.append(p_bdr)

    def pt(base: float) -> Pt:
        return Pt(base * scale)

    doc = Document()
    doc.styles["Normal"].font.name = "Times New Roman"
    margin_pt = max(0.4, 0.5 * (0.85 + 0.15 * scale)) * 72
    for section in doc.sections:
        section.top_margin = section.bottom_margin = Pt(margin_pt)
        section.left_margin = section.right_margin = Pt(margin_pt)
    usable_width = doc.sections[0].page_width - doc.sections[0].left_margin - doc.sections[0].right_margin

    contact = tailored.contact

    name_p = doc.add_paragraph()
    name_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    name_run = name_p.add_run(contact.name)
    name_run.font.size = pt(23)
    name_run.font.name = "Times New Roman"

    if contact.location:
        location_p = doc.add_paragraph()
        location_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        location_run = location_p.add_run(contact.location)
        location_run.font.size = pt(10)
        location_run.font.name = "Times New Roman"

    contact_p = doc.add_paragraph()
    contact_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    if contact.phone:
        add_hyperlink(contact_p, _tel_href(contact.phone), contact.phone)
        contact_p.add_run("   ")
    add_hyperlink(contact_p, f"mailto:{contact.email}", contact.email)
    for link in contact.links:
        contact_p.add_run("   ")
        add_hyperlink(contact_p, _normalize_url(link), _link_label(link))
    for run in contact_p.runs:
        run.font.size = pt(10)
        run.font.name = "Times New Roman"

    for heading, items in tailored.sections():
        h = doc.add_paragraph()
        h_run = h.add_run(heading.upper())
        h_run.bold = True
        h_run.font.size = pt(13)
        h_run.font.name = "Times New Roman"
        add_bottom_border(h)

        dash = heading not in _NO_DASH_SECTIONS
        for item in items:
            if item.title:
                table = doc.add_table(rows=1, cols=2)
                table.alignment = WD_TABLE_ALIGNMENT.LEFT
                table.autofit = False
                table.columns[0].width = int(usable_width * 0.7)
                table.columns[1].width = int(usable_width * 0.3)
                left_run = table.rows[0].cells[0].paragraphs[0].add_run(item.title)
                left_run.bold = True
                left_run.font.size = pt(10)
                left_run.font.name = "Times New Roman"
                right_p = table.rows[0].cells[1].paragraphs[0]
                right_p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
                right_run = right_p.add_run(item.dates or "")
                right_run.bold = True
                right_run.font.size = pt(10)
                right_run.font.name = "Times New Roman"
            elif item.dates:
                dates_p = doc.add_paragraph()
                dates_run = dates_p.add_run(item.dates)
                dates_run.bold = True
                dates_run.font.size = pt(10)
                dates_run.font.name = "Times New Roman"
            for bullet in item.bullets:
                b_p = doc.add_paragraph()
                b_run = b_p.add_run(f"– {bullet}" if dash else bullet)
                b_run.font.size = pt(10)
                b_run.font.name = "Times New Roman"

    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    doc.save(output_path)
