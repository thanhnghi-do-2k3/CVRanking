from enum import StrEnum

from pydantic import Field

from app.models.documents import Evidence, StrictModel


class RequirementStatus(StrEnum):
    MET = "met"
    PARTIALLY_MET = "partially_met"
    NOT_FOUND = "not_found"
    NOT_MET = "not_met"
    UNKNOWN = "unknown"


class EligibilityStatus(StrEnum):
    ELIGIBLE = "eligible"
    POTENTIALLY_ELIGIBLE = "potentially_eligible"
    CONSTRAINT_UNKNOWN = "constraint_unknown"
    CONSTRAINT_FAILED = "constraint_failed"


class RequirementAssessment(StrictModel):
    requirement_id: str = Field(min_length=1, max_length=100)
    status: RequirementStatus
    score: float = Field(ge=0, le=1)
    confidence: float = Field(ge=0, le=1)
    evidences: list[Evidence] = Field(default_factory=list)


class RerankResult(StrictModel):
    candidate_id: str = Field(min_length=1)
    requirement_assessments: list[RequirementAssessment]
    strengths: list[str] = Field(default_factory=list)
    gaps: list[str] = Field(default_factory=list)
    unknowns: list[str] = Field(default_factory=list)
    overall_score: float = Field(ge=0, le=1)
    eligibility_status: EligibilityStatus
    model_version: str = Field(min_length=1)
    prompt_version: str = Field(min_length=1)
