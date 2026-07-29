from typing import Literal

from pydantic import Field

from app.models.documents import CandidateExtraction, Evidence, ParsedDocument, StrictModel
from app.models.ranking import EligibilityStatus, RequirementAssessment


class JobRequirement(StrictModel):
    requirement_key: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=200)
    requirement_type: Literal[
        "skill", "experience", "education", "certification", "language", "location", "other"
    ]
    priority: Literal["must_have", "nice_to_have"]
    weight: float = Field(gt=0, le=10)
    minimum_years: float | None = Field(default=None, ge=0, le=80)
    is_hard_constraint: bool = False
    description: str = Field(default="", max_length=1000)
    source_evidence: list[Evidence] = Field(default_factory=list)


class JobParseRequest(StrictModel):
    title: str = Field(min_length=2, max_length=200)
    description: str = Field(min_length=20, max_length=100_000)


class JobParseResult(StrictModel):
    title: str
    summary: str
    seniority: str | None = None
    requirements: list[JobRequirement]
    parser_version: str


class ResumeAnalysis(StrictModel):
    document: ParsedDocument
    candidate: CandidateExtraction


class RankingSkill(StrictModel):
    name: str = Field(min_length=1, max_length=200)
    estimated_years: float | None = Field(default=None, ge=0, le=80)
    evidences: list[Evidence] = Field(default_factory=list)


class RankingCandidate(StrictModel):
    candidate_id: str = Field(min_length=1)
    current_title: str = Field(default="", max_length=300)
    total_years_experience: float | None = Field(default=None, ge=0, le=80)
    skills: list[RankingSkill] = Field(default_factory=list)


class RankingRequest(StrictModel):
    requirements: list[JobRequirement] = Field(min_length=1)
    candidates: list[RankingCandidate] = Field(min_length=1, max_length=500)


class RankedCandidate(StrictModel):
    candidate_id: str
    rank: int = Field(ge=1)
    final_score: float = Field(ge=0, le=1)
    confidence: float = Field(ge=0, le=1)
    eligibility_status: EligibilityStatus
    strengths: list[str] = Field(default_factory=list)
    gaps: list[str] = Field(default_factory=list)
    unknowns: list[str] = Field(default_factory=list)
    requirement_assessments: list[RequirementAssessment]
    model_version: str
    feature_schema_version: str


class RankingResponse(StrictModel):
    results: list[RankedCandidate]
    model_version: str
    feature_schema_version: str
