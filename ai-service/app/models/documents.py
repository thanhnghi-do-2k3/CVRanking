from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Evidence(StrictModel):
    id: str = Field(min_length=1, max_length=100)
    text: str = Field(min_length=1, max_length=4000)
    page: int | None = Field(default=None, ge=1)
    start_offset: int | None = Field(default=None, ge=0)
    end_offset: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def offsets_are_ordered(self) -> "Evidence":
        if (
            self.start_offset is not None
            and self.end_offset is not None
            and self.end_offset < self.start_offset
        ):
            raise ValueError("end_offset must be greater than or equal to start_offset")
        return self


class DocumentPage(StrictModel):
    number: int = Field(ge=1)
    text: str
    start_offset: int = Field(ge=0)
    end_offset: int = Field(ge=0)


class DocumentSection(StrictModel):
    kind: str = Field(min_length=1, max_length=100)
    text: str
    page_start: int | None = Field(default=None, ge=1)
    page_end: int | None = Field(default=None, ge=1)
    start_offset: int = Field(ge=0)
    end_offset: int = Field(ge=0)


class ParsedDocument(StrictModel):
    text: str
    pages: list[DocumentPage]
    sections: list[DocumentSection] = Field(default_factory=list)
    metadata: dict[str, str | int | float | bool | None] = Field(default_factory=dict)
    parser_version: str = Field(min_length=1)
    used_ocr: bool = False


class ExtractedField[ValueT](StrictModel):
    value: ValueT
    confidence: float = Field(ge=0, le=1)
    evidences: list[Evidence] = Field(default_factory=list)
    extraction_method: Literal["rule", "model", "llm", "human"]
    prompt_version: str | None = None
    model_version: str = Field(min_length=1)


class ExtractedSkill(StrictModel):
    name: str = Field(min_length=1, max_length=200)
    normalized_name: str | None = Field(default=None, max_length=200)
    match_kind: Literal["explicit", "related", "inferred", "unknown"]
    estimated_years: float | None = Field(default=None, ge=0, le=80)
    last_used_at: date | None = None
    confidence: float = Field(ge=0, le=1)
    evidences: list[Evidence] = Field(default_factory=list)

    @model_validator(mode="after")
    def non_unknown_skill_requires_evidence(self) -> "ExtractedSkill":
        if self.match_kind != "unknown" and not self.evidences:
            raise ValueError("a non-unknown skill must contain evidence")
        return self


class CandidateExtraction(StrictModel):
    full_name: ExtractedField[str] | None = None
    email: ExtractedField[str] | None = None
    phone: ExtractedField[str] | None = None
    current_title: ExtractedField[str] | None = None
    summary: ExtractedField[str] | None = None
    total_years_experience: ExtractedField[float] | None = None
    skills: list[ExtractedSkill] = Field(default_factory=list)
    work_experiences: list[dict] = Field(default_factory=list)
    educations: list[dict] = Field(default_factory=list)
    certifications: list[dict] = Field(default_factory=list)
    languages: list[dict] = Field(default_factory=list)
    projects: list[dict] = Field(default_factory=list)
    locations: list[dict] = Field(default_factory=list)
    extraction_model_version: str = Field(min_length=1)
    prompt_version: str | None = None
