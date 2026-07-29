import hashlib
import re
from io import BytesIO
from pathlib import Path

import fitz
from docx import Document

from app.models.documents import (
    CandidateExtraction,
    DocumentPage,
    Evidence,
    ExtractedField,
    ExtractedSkill,
    ParsedDocument,
)
from app.models.mvp import JobParseRequest, JobParseResult, JobRequirement, ResumeAnalysis

PARSER_VERSION = "local-parser-v1"
EXTRACTION_VERSION = "local-rules-v1"

SKILL_ALIASES: dict[str, tuple[str, ...]] = {
    "Go": ("golang",),
    "Python": (),
    "Java": (),
    "JavaScript": ("javascript", "js"),
    "TypeScript": ("typescript", "ts"),
    "React": ("react.js", "reactjs"),
    "Next.js": ("nextjs", "next js"),
    "Node.js": ("nodejs", "node js"),
    "C#": ("csharp",),
    ".NET": ("dotnet", "asp.net"),
    "PHP": (),
    "Ruby": (),
    "Rust": (),
    "C++": ("cpp",),
    "AWS": ("amazon web services",),
    "Azure": (),
    "GCP": ("google cloud", "google cloud platform"),
    "Docker": (),
    "Kubernetes": ("k8s", "aws eks", "eks"),
    "PostgreSQL": ("postgres", "postgresql"),
    "MySQL": (),
    "SQL": (),
    "MongoDB": ("mongo",),
    "Redis": (),
    "Kafka": ("apache kafka",),
    "RabbitMQ": (),
    "GraphQL": (),
    "REST": ("rest api", "restful"),
    "gRPC": (),
    "Microservices": ("microservice", "micro-services"),
    "Linux": (),
    "Git": (),
    "Terraform": (),
    "CI/CD": ("cicd", "continuous integration", "continuous delivery"),
    "Machine Learning": ("machine learning", "ml"),
    "NLP": ("natural language processing",),
    "PyTorch": (),
    "TensorFlow": (),
    "FastAPI": (),
    "Django": (),
    "Flask": (),
    "Spring Boot": ("springboot",),
    "Gin": (),
    "Chi": (),
    "HTML": (),
    "CSS": (),
}

CONTACT_LINE = re.compile(
    r"(?i)(?:[\w.+-]+@[\w.-]+\.[a-z]{2,}|\+?\d[\d\s().-]{7,}\d|linkedin\.com)"
)
YEAR_PATTERN = re.compile(r"(?i)(\d{1,2}(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?|năm)")
TITLE_PATTERN = re.compile(
    r"(?i)\b(engineer|developer|architect|scientist|manager|specialist|consultant|"
    r"kỹ sư|lập trình viên|trưởng nhóm|quản lý)\b"
)


def _phrase_pattern(phrase: str) -> re.Pattern[str]:
    if phrase == "Go":
        return re.compile(r"\b(?:Go|Golang)\b")
    if phrase in {"C++", "C#", ".NET", "CI/CD"}:
        return re.compile(re.escape(phrase), re.IGNORECASE)
    return re.compile(r"(?<![\w])" + re.escape(phrase) + r"(?![\w])", re.IGNORECASE)


def normalize_skill(value: str) -> str | None:
    for canonical, aliases in SKILL_ALIASES.items():
        if value.casefold() in {canonical.casefold(), *(alias.casefold() for alias in aliases)}:
            return canonical
    return None


def _skill_mentions(text: str) -> list[tuple[str, re.Match[str]]]:
    found: list[tuple[str, re.Match[str]]] = []
    for canonical, aliases in SKILL_ALIASES.items():
        matches: list[re.Match[str]] = []
        for phrase in (canonical, *aliases):
            matches.extend(_phrase_pattern(phrase).finditer(text))
        if matches:
            found.append((canonical, min(matches, key=lambda match: match.start())))
    return sorted(found, key=lambda item: item[1].start())


def _line_excerpt(text: str, offset: int, limit: int = 500) -> tuple[str, int, int]:
    start = text.rfind("\n", 0, offset) + 1
    end = text.find("\n", offset)
    if end < 0:
        end = len(text)
    excerpt = text[start:end].strip()
    if not excerpt:
        start = max(0, offset - 100)
        end = min(len(text), offset + 200)
        excerpt = text[start:end].strip()
    return excerpt[:limit], start, min(end, start + limit)


def _page_for_offset(document: ParsedDocument, offset: int) -> int | None:
    for page in document.pages:
        if page.start_offset <= offset <= page.end_offset:
            return page.number
    return None


def _evidence(document: ParsedDocument, text: str, offset: int, prefix: str) -> Evidence:
    excerpt, start, end = _line_excerpt(text, offset)
    digest = hashlib.sha1(f"{prefix}:{start}:{excerpt}".encode()).hexdigest()[:20]
    return Evidence(
        id=f"{prefix}-{digest}",
        text=excerpt,
        page=_page_for_offset(document, start),
        start_offset=start,
        end_offset=end,
    )


def parse_document(filename: str, content_type: str, data: bytes) -> ParsedDocument:
    suffix = Path(filename).suffix.lower()
    if content_type == "application/pdf" or suffix == ".pdf":
        source = fitz.open(stream=data, filetype="pdf")
        raw_pages = [page.get_text("text").strip() for page in source]
        source.close()
    elif (
        content_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        or suffix == ".docx"
    ):
        document = Document(BytesIO(data))
        raw_pages = ["\n".join(paragraph.text for paragraph in document.paragraphs).strip()]
    else:
        raise ValueError("only PDF and DOCX files are supported")

    if not any(raw_pages):
        raise ValueError("the document does not contain an extractable text layer")
    pages: list[DocumentPage] = []
    parts: list[str] = []
    offset = 0
    for number, page_text in enumerate(raw_pages, start=1):
        if parts:
            parts.append("\n")
            offset += 1
        start = offset
        parts.append(page_text)
        offset += len(page_text)
        pages.append(
            DocumentPage(
                number=number,
                text=page_text,
                start_offset=start,
                end_offset=offset,
            )
        )
    return ParsedDocument(
        text="".join(parts),
        pages=pages,
        metadata={"filename": filename, "page_count": len(pages)},
        parser_version=PARSER_VERSION,
        used_ocr=False,
    )


def _field(value: str | float, evidence: Evidence) -> ExtractedField:
    return ExtractedField(
        value=value,
        confidence=0.88,
        evidences=[evidence],
        extraction_method="rule",
        model_version=EXTRACTION_VERSION,
    )


def analyze_resume(filename: str, content_type: str, data: bytes) -> ResumeAnalysis:
    document = parse_document(filename, content_type, data)
    text = document.text
    lines = [(line.strip(), text.find(line)) for line in text.splitlines() if line.strip()]
    email_match = re.search(r"(?i)[\w.+-]+@[\w.-]+\.[a-z]{2,}", text)
    phone_match = re.search(r"(?<!\w)\+?\d[\d\s().-]{7,}\d(?!\w)", text)

    name_line = next(
        (
            (line, offset)
            for line, offset in lines[:8]
            if len(line) <= 100 and not CONTACT_LINE.search(line) and not TITLE_PATTERN.search(line)
        ),
        None,
    )
    title_line = next(
        ((line, offset) for line, offset in lines[:20] if TITLE_PATTERN.search(line)),
        None,
    )
    years = [float(match.group(1)) for match in YEAR_PATTERN.finditer(text)]
    skills: list[ExtractedSkill] = []
    for canonical, match in _skill_mentions(text):
        evidence = _evidence(document, text, match.start(), f"skill-{canonical.casefold()}")
        context_start = max(0, match.start() - 80)
        context_end = min(len(text), match.end() + 80)
        years_nearby = YEAR_PATTERN.search(text[context_start:context_end])
        skills.append(
            ExtractedSkill(
                name=match.group(0),
                normalized_name=canonical,
                match_kind="explicit",
                estimated_years=float(years_nearby.group(1)) if years_nearby else None,
                confidence=0.95,
                evidences=[evidence],
            )
        )

    safe_summary_lines = [
        line
        for line, _ in lines[:12]
        if not CONTACT_LINE.search(line) and line != (name_line or ("", 0))[0]
    ]
    summary_text = " · ".join(safe_summary_lines)[:600] or "CV đã được trích xuất."
    summary_offset = text.find(safe_summary_lines[0]) if safe_summary_lines else 0
    summary_evidence = _evidence(document, text, max(0, summary_offset), "summary")

    return ResumeAnalysis(
        document=document,
        candidate=CandidateExtraction(
            full_name=(
                _field(name_line[0], _evidence(document, text, name_line[1], "name"))
                if name_line
                else None
            ),
            email=(
                _field(
                    email_match.group(0),
                    _evidence(document, text, email_match.start(), "email"),
                )
                if email_match
                else None
            ),
            phone=(
                _field(
                    phone_match.group(0).strip(),
                    _evidence(document, text, phone_match.start(), "phone"),
                )
                if phone_match
                else None
            ),
            current_title=(
                _field(title_line[0], _evidence(document, text, title_line[1], "title"))
                if title_line
                else None
            ),
            summary=_field(summary_text, summary_evidence),
            total_years_experience=(
                _field(
                    max(years),
                    _evidence(
                        document,
                        text,
                        next(YEAR_PATTERN.finditer(text)).start(),
                        "experience",
                    ),
                )
                if years
                else None
            ),
            skills=skills,
            extraction_model_version=EXTRACTION_VERSION,
        ),
    )


def parse_job(payload: JobParseRequest) -> JobParseResult:
    description = payload.description
    requirements: list[JobRequirement] = []
    counter = 1
    for canonical, match in _skill_mentions(description):
        excerpt, start, end = _line_excerpt(description, match.start())
        lowered = excerpt.casefold()
        nice = any(
            marker in lowered
            for marker in ("nice to have", "preferred", "plus", "ưu tiên", "lợi thế")
        )
        years_match = YEAR_PATTERN.search(excerpt)
        requirements.append(
            JobRequirement(
                requirement_key=f"R{counter}",
                name=canonical,
                requirement_type="skill",
                priority="nice_to_have" if nice else "must_have",
                weight=0.6 if nice else 1.0,
                minimum_years=float(years_match.group(1)) if years_match else None,
                is_hard_constraint=False,
                description=excerpt,
                source_evidence=[
                    Evidence(
                        id=f"jd-{counter}",
                        text=excerpt,
                        start_offset=start,
                        end_offset=end,
                    )
                ],
            )
        )
        counter += 1

    general_years = YEAR_PATTERN.search(description)
    if general_years:
        excerpt, start, end = _line_excerpt(description, general_years.start())
        requirements.append(
            JobRequirement(
                requirement_key=f"R{counter}",
                name="Kinh nghiệm liên quan",
                requirement_type="experience",
                priority="must_have",
                weight=1.0,
                minimum_years=float(general_years.group(1)),
                description=excerpt,
                source_evidence=[
                    Evidence(
                        id=f"jd-{counter}",
                        text=excerpt,
                        start_offset=start,
                        end_offset=end,
                    )
                ],
            )
        )
        counter += 1

    requirements.append(
        JobRequirement(
            requirement_key=f"R{counter}",
            name=payload.title,
            requirement_type="other",
            priority="nice_to_have",
            weight=0.5,
            description="Mức độ tương đồng giữa chức danh hiện tại và vị trí tuyển dụng.",
        )
    )
    seniority = next(
        (
            value
            for value in ("principal", "lead", "senior", "mid", "junior", "intern")
            if value in f"{payload.title} {description[:500]}".casefold()
        ),
        None,
    )
    summary = re.sub(r"\s+", " ", description).strip()[:800]
    return JobParseResult(
        title=payload.title,
        summary=summary,
        seniority=seniority,
        requirements=requirements,
        parser_version="jd-rules-v1",
    )
