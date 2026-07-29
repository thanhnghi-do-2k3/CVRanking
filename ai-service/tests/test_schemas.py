import pytest
from pydantic import ValidationError

from app.extraction.evidence import UnverifiableEvidenceError, validate_evidence_references
from app.models.documents import Evidence, ExtractedSkill
from app.models.ranking import EligibilityStatus, RequirementAssessment, RerankResult


def test_explicit_skill_requires_evidence() -> None:
    with pytest.raises(ValidationError):
        ExtractedSkill(
            name="Go",
            normalized_name="Golang",
            match_kind="explicit",
            confidence=0.9,
            evidences=[],
        )


def test_not_found_remains_distinct_from_not_met() -> None:
    not_found = RequirementAssessment(
        requirement_id="R1",
        status="not_found",
        score=0,
        confidence=0.4,
    )
    not_met = RequirementAssessment(
        requirement_id="R1",
        status="not_met",
        score=0,
        confidence=0.9,
    )

    assert not_found.status != not_met.status


def test_unknown_evidence_reference_is_rejected() -> None:
    result = RerankResult(
        candidate_id="candidate-1",
        requirement_assessments=[
            RequirementAssessment(
                requirement_id="R1",
                status="met",
                score=0.9,
                confidence=0.8,
                evidences=[Evidence(id="fabricated", text="Unverifiable", page=1)],
            )
        ],
        overall_score=0.9,
        eligibility_status=EligibilityStatus.ELIGIBLE,
        model_version="test-model",
        prompt_version="test-prompt",
    )

    with pytest.raises(UnverifiableEvidenceError):
        validate_evidence_references(result, {"real-evidence"})
