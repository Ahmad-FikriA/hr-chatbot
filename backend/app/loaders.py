import csv
import os
import re
from typing import List, Optional
from langchain_core.documents import Document

try:
    import pymupdf as fitz
except ImportError:
    fitz = None

try:
    import openpyxl
except ImportError:
    openpyxl = None

try:
    from pptx import Presentation
except ImportError:
    Presentation = None

SUPPORTED_EXTENSIONS = {".md", ".pdf", ".xlsx", ".xls", ".pptx", ".csv", ".png", ".jpg", ".jpeg"}


def extract_equipment_context(rel_path: str) -> Optional[str]:
    """Extract equipment tag/set name from directory path if present."""
    parts = rel_path.split(os.sep)
    for part in parts:
        if part.startswith("Set_") or re.match(r"^[A-Z]{2}-\d{4}", part):
            return part
    return None


def load_pdf(file_path: str, rel_path: str) -> List[Document]:
    """Extract text from PDF pages with page-level metadata."""
    if not fitz:
        raise ImportError("PyMuPDF (fitz) is not installed.")

    docs = []
    doc_fitz = fitz.open(file_path)
    total_pages = len(doc_fitz)
    equipment = extract_equipment_context(rel_path)

    full_text_pages = []
    for page_num in range(total_pages):
        page = doc_fitz[page_num]
        text = page.get_text("text").strip()
        if text:
            full_text_pages.append((page_num + 1, text))

    doc_fitz.close()

    filename = os.path.basename(file_path)
    if not full_text_pages:
        # Scanned or drawing PDF with no embedded text
        stub_content = f"# {filename}\nCategory: {equipment or 'General'}\nType: Document / Diagram (PDF Document)\nFile: {rel_path}"
        docs.append(
            Document(
                page_content=stub_content,
                metadata={
                    "source": rel_path,
                    "filename": filename,
                    "file_type": "pdf",
                    "equipment": equipment or "",
                    "is_drawing": True,
                },
            )
        )
    else:
        # Group text with header
        doc_body = f"# Document: {filename}\n"
        if equipment:
            doc_body += f"Category / Tag: {equipment}\n\n"
        for pnum, ptext in full_text_pages:
            doc_body += f"--- Page {pnum} of {total_pages} ---\n{ptext}\n\n"

        docs.append(
            Document(
                page_content=doc_body.strip(),
                metadata={
                    "source": rel_path,
                    "filename": filename,
                    "file_type": "pdf",
                    "equipment": equipment or "",
                    "pages": total_pages,
                },
            )
        )

    return docs


def load_xlsx(file_path: str, rel_path: str) -> List[Document]:
    """Extract tabular data from Excel sheets as general structured documents for knowledge retrieval."""
    if not openpyxl:
        raise ImportError("openpyxl is not installed.")

    docs = []
    wb = openpyxl.load_workbook(file_path, data_only=True)
    filename = os.path.basename(file_path)
    equipment = extract_equipment_context(rel_path)

    for sheet_name in wb.sheetnames:
        sheet = wb[sheet_name]
        rows = list(sheet.iter_rows(values_only=True))
        if not rows:
            continue

        non_empty_rows = [r for r in rows if any(cell is not None and str(cell).strip() != "" for cell in r)]
        if not non_empty_rows:
            continue

        headers = [str(c or "").strip() for c in non_empty_rows[0]]
        headers = [h if h else f"Column {i+1}" for i, h in enumerate(headers)]
        data_rows = non_empty_rows[1:]

        if not data_rows:
            content = f"# Spreadsheet: {filename}\nSheet: {sheet_name}\n\nHeaders: " + " | ".join(headers)
            docs.append(
                Document(
                    page_content=content,
                    metadata={
                        "source": rel_path,
                        "filename": filename,
                        "file_type": "xlsx",
                        "sheet": sheet_name,
                        "equipment": equipment or "",
                    },
                )
            )
            continue

        chunk_size = 30
        # Add a dataset overview chunk for general/summary questions
        overview_content = (
            f"# Spreadsheet Overview: {filename} • Sheet: {sheet_name}\n"
            f"Source File: {filename}\n"
            f"Total Rows: {len(data_rows)} data records\n"
            f"Columns ({len(headers)}): {', '.join(headers)}\n"
        )
        if equipment:
            overview_content += f"Category / Tag: {equipment}\n"
        docs.append(
            Document(
                page_content=overview_content.strip(),
                metadata={
                    "source": rel_path,
                    "filename": filename,
                    "file_type": "xlsx",
                    "sheet": sheet_name,
                    "equipment": equipment or "",
                    "is_overview": True,
                },
            )
        )

        for chunk_idx, i in enumerate(range(0, len(data_rows), chunk_size)):
            chunk = data_rows[i : i + chunk_size]
            record_lines = []
            for row_num, row in enumerate(chunk, start=i + 2):
                items = []
                for h, cell_val in zip(headers, row):
                    if cell_val is not None and str(cell_val).strip() != "":
                        items.append(f"{h}: {str(cell_val).strip()}")
                if items:
                    record_lines.append(f"- Row {row_num}: " + " | ".join(items))

            if record_lines:
                total_chunks = (len(data_rows) + chunk_size - 1) // chunk_size
                header_info = f"# Spreadsheet: {filename} • Sheet: {sheet_name}"
                if total_chunks > 1:
                    header_info += f" (Part {chunk_idx + 1} of {total_chunks})"
                if equipment:
                    header_info += f"\nCategory / Tag: {equipment}"

                content = f"{header_info}\nSource File: {filename}\n\n" + "\n".join(record_lines)
                docs.append(
                    Document(
                        page_content=content,
                        metadata={
                            "source": rel_path,
                            "filename": filename,
                            "file_type": "xlsx",
                            "sheet": sheet_name,
                            "equipment": equipment or "",
                        },
                    )
                )

    wb.close()
    return docs


def load_csv(file_path: str, rel_path: str) -> List[Document]:
    """Extract tabular data from CSV files for knowledge retrieval."""
    docs = []
    filename = os.path.basename(file_path)
    equipment = extract_equipment_context(rel_path)

    rows = []
    for enc in ("utf-8-sig", "utf-8", "latin-1", "cp1252"):
        try:
            with open(file_path, "r", encoding=enc, errors="replace") as f:
                sample = f.read(2048)
                f.seek(0)
                try:
                    dialect = csv.Sniffer().sniff(sample, delimiters=",\t;|")
                    delimiter = dialect.delimiter
                except Exception:
                    delimiter = ","
                reader = csv.reader(f, delimiter=delimiter)
                rows = [row for row in reader if any(cell.strip() for cell in row)]
            break
        except Exception:
            continue

    if not rows:
        return docs

    headers = [h.strip() if h.strip() else f"Column {i+1}" for i, h in enumerate(rows[0])]
    data_rows = rows[1:]

    if not data_rows:
        content = f"# CSV Document: {filename}\nHeaders: " + " | ".join(headers)
        docs.append(
            Document(
                page_content=content,
                metadata={
                    "source": rel_path,
                    "filename": filename,
                    "file_type": "csv",
                    "equipment": equipment or "",
                },
            )
        )
        return docs

    # Add a dataset overview chunk for general/summary questions
    overview_content = (
        f"# CSV Dataset Overview: {filename}\n"
        f"Source File: {filename}\n"
        f"Total Rows: {len(data_rows)} records\n"
        f"Columns ({len(headers)}): {', '.join(headers)}\n"
    )
    if equipment:
        overview_content += f"Category / Tag: {equipment}\n"
    docs.append(
        Document(
            page_content=overview_content.strip(),
            metadata={
                "source": rel_path,
                "filename": filename,
                "file_type": "csv",
                "equipment": equipment or "",
                "is_overview": True,
            },
        )
    )

    chunk_size = 30
    for chunk_idx, i in enumerate(range(0, len(data_rows), chunk_size)):
        chunk = data_rows[i : i + chunk_size]
        record_lines = []
        for row_num, row in enumerate(chunk, start=i + 2):
            items = []
            for h, cell_val in zip(headers, row):
                cell_str = cell_val.strip()
                if cell_str:
                    items.append(f"{h}: {cell_str}")
            if items:
                record_lines.append(f"- Row {row_num}: " + " | ".join(items))

        if record_lines:
            total_chunks = (len(data_rows) + chunk_size - 1) // chunk_size
            header_info = f"# CSV Document: {filename}"
            if total_chunks > 1:
                header_info += f" (Part {chunk_idx + 1} of {total_chunks})"
            if equipment:
                header_info += f"\nCategory / Tag: {equipment}"

            content = f"{header_info}\nSource File: {filename}\n\n" + "\n".join(record_lines)
            docs.append(
                Document(
                    page_content=content,
                    metadata={
                        "source": rel_path,
                        "filename": filename,
                        "file_type": "csv",
                        "equipment": equipment or "",
                    },
                )
            )

    return docs


def load_pptx(file_path: str, rel_path: str) -> List[Document]:
    """Extract slide text from PowerPoint presentation."""
    if not Presentation:
        raise ImportError("python-pptx is not installed.")

    prs = Presentation(file_path)
    filename = os.path.basename(file_path)
    equipment = extract_equipment_context(rel_path)

    slide_texts = []
    for idx, slide in enumerate(prs.slides, start=1):
        texts = []
        for shape in slide.shapes:
            if shape.has_text_frame and shape.text.strip():
                texts.append(shape.text.strip())
        if texts:
            slide_texts.append(f"--- Slide {idx} ---\n" + "\n".join(texts))

    if not slide_texts:
        content = f"# Presentation: {filename}\nFile: {rel_path}\nNo text extracted from slides."
    else:
        content = f"# Presentation: {filename}\n\n" + "\n\n".join(slide_texts)

    return [
        Document(
            page_content=content,
            metadata={
                "source": rel_path,
                "filename": filename,
                "file_type": "pptx",
                "equipment": equipment or "",
            },
        )
    ]


def load_image_stub(file_path: str, rel_path: str) -> List[Document]:
    """Generate search context document for diagrams & graphic images."""
    filename = os.path.basename(file_path)
    equipment = extract_equipment_context(rel_path)
    ext = os.path.splitext(filename)[1].lower().replace(".", "")

    content = f"# Diagram / Image: {filename}\n"
    if equipment:
        content += f"Category / Tag: {equipment}\n"
    content += f"Type: Graphic / Diagram ({ext.upper()})\n"
    content += f"File Path: {rel_path}\n"
    content += f"Description: Image or diagram for {equipment or filename}."

    return [
        Document(
            page_content=content,
            metadata={
                "source": rel_path,
                "filename": filename,
                "file_type": ext,
                "is_image": True,
                "equipment": equipment or "",
            },
        )
    ]


def load_markdown(file_path: str, rel_path: str) -> List[Document]:
    """Load standard markdown file."""
    with open(file_path, "r", encoding="utf-8") as f:
        content = f.read()
    filename = os.path.basename(file_path)
    equipment = extract_equipment_context(rel_path)
    return [
        Document(
            page_content=content,
            metadata={
                "source": rel_path,
                "filename": filename,
                "file_type": "md",
                "equipment": equipment or "",
            },
        )
    ]


def load_all_documents(knowledge_dir: str) -> List[Document]:
    """Walk directory recursively and load all supported documents."""
    if not os.path.exists(knowledge_dir):
        raise FileNotFoundError(f"Knowledge directory not found at {knowledge_dir}")

    all_docs = []
    for root, _, files in os.walk(knowledge_dir):
        for file in sorted(files):
            if file.startswith(".") or file.startswith("~$"):
                continue

            file_path = os.path.join(root, file)
            rel_path = os.path.relpath(file_path, knowledge_dir)
            ext = os.path.splitext(file)[1].lower()

            if ext not in SUPPORTED_EXTENSIONS:
                continue

            try:
                if ext == ".md":
                    all_docs.extend(load_markdown(file_path, rel_path))
                elif ext == ".pdf":
                    all_docs.extend(load_pdf(file_path, rel_path))
                elif ext in (".xlsx", ".xls"):
                    all_docs.extend(load_xlsx(file_path, rel_path))
                elif ext == ".csv":
                    all_docs.extend(load_csv(file_path, rel_path))
                elif ext == ".pptx":
                    all_docs.extend(load_pptx(file_path, rel_path))
                elif ext in (".png", ".jpg", ".jpeg"):
                    all_docs.extend(load_image_stub(file_path, rel_path))
            except Exception as e:
                print(f"Warning: Failed to load {rel_path}: {e}")

    return all_docs


def get_preview_text(full_path: str, rel_path: str) -> str:
    """Return text/markdown representation for previewing in UI."""
    ext = os.path.splitext(full_path)[1].lower()
    filename = os.path.basename(full_path)
    equipment = extract_equipment_context(rel_path)

    if ext == ".md":
        with open(full_path, "r", encoding="utf-8") as f:
            return f.read()

    elif ext == ".pdf":
        if not fitz:
            return f"# {filename}\n\nPyMuPDF is not installed."
        doc_fitz = fitz.open(full_path)
        pages = []
        for i, page in enumerate(doc_fitz):
            t = page.get_text("text").strip()
            pages.append(f"### Page {i + 1}\n{t if t else '*(Visual drawing or non-text page)*'}")
        doc_fitz.close()
        header = f"# {filename}\n"
        if equipment:
            header += f"**Category / Tag:** {equipment}\n\n"
        return header + "\n\n---\n\n".join(pages)

    elif ext in (".xlsx", ".xls"):
        if not openpyxl:
            return f"# {filename}\n\nopenpyxl is not installed."
        wb = openpyxl.load_workbook(full_path, data_only=True)
        sections = []
        for sheet_name in wb.sheetnames:
            sheet = wb[sheet_name]
            rows = list(sheet.iter_rows(values_only=True))
            non_empty = [r for r in rows if any(c is not None and str(c).strip() != "" for c in r)]
            if not non_empty:
                continue
            headers = [str(c or "").strip() for c in non_empty[0]]
            sheet_lines = [f"## Sheet: {sheet_name}"]
            for row in non_empty[1:100]:  # Limit preview to 100 rows
                items = [f"**{h or 'Field'}**: {val}" for h, val in zip(headers, row) if val is not None and str(val).strip()]
                if items:
                    sheet_lines.append("- " + " | ".join(items))
            sections.append("\n".join(sheet_lines))
        wb.close()
        return f"# {filename}\n\n" + "\n\n---\n\n".join(sections)

    elif ext == ".csv":
        rows = []
        for enc in ("utf-8-sig", "utf-8", "latin-1", "cp1252"):
            try:
                with open(full_path, "r", encoding=enc, errors="replace") as f:
                    sample = f.read(2048)
                    f.seek(0)
                    try:
                        dialect = csv.Sniffer().sniff(sample, delimiters=",\t;|")
                        delimiter = dialect.delimiter
                    except Exception:
                        delimiter = ","
                    reader = csv.reader(f, delimiter=delimiter)
                    rows = [row for row in reader if any(cell.strip() for cell in row)]
                break
            except Exception:
                continue
        if not rows:
            return f"# {filename}\n\n*(Empty CSV file)*"
        headers = [h.strip() if h.strip() else f"Column {i+1}" for i, h in enumerate(rows[0])]
        lines = [f"# {filename}\n"]
        for row_num, row in enumerate(rows[1:101], start=2):
            items = [f"**{h}**: {cell.strip()}" for h, cell in zip(headers, row) if cell.strip()]
            if items:
                lines.append("- " + " | ".join(items))
        return "\n".join(lines)

    elif ext == ".pptx":
        if not Presentation:
            return f"# {filename}\n\npython-pptx is not installed."
        prs = Presentation(full_path)
        slides = []
        for i, slide in enumerate(prs.slides, 1):
            text_items = [shape.text.strip() for shape in slide.shapes if shape.has_text_frame and shape.text.strip()]
            slides.append(f"### Slide {i}\n" + ("\n".join(text_items) if text_items else "*(Visual slide)*"))
        return f"# {filename}\n\n" + "\n\n---\n\n".join(slides)

    elif ext in (".png", ".jpg", ".jpeg"):
        return f"# {filename}\n\nImage file located at `{rel_path}`. Preview rendered below."

    return f"# {filename}\n\nUnsupported preview type."


def load_single_document(file_path: str, rel_path: str) -> List[Document]:
    """Load and return Document(s) for a single file, dispatching by extension.
    
    Used by the upload endpoint to parse a newly uploaded file without
    walking an entire directory.
    """
    ext = os.path.splitext(file_path)[1].lower()

    if ext not in SUPPORTED_EXTENSIONS:
        raise ValueError(f"Unsupported file type: {ext}")

    if ext == ".md":
        return load_markdown(file_path, rel_path)
    elif ext == ".pdf":
        return load_pdf(file_path, rel_path)
    elif ext in (".xlsx", ".xls"):
        return load_xlsx(file_path, rel_path)
    elif ext == ".csv":
        return load_csv(file_path, rel_path)
    elif ext == ".pptx":
        return load_pptx(file_path, rel_path)
    elif ext in (".png", ".jpg", ".jpeg"):
        return load_image_stub(file_path, rel_path)
    else:
        raise ValueError(f"Unsupported file type: {ext}")
