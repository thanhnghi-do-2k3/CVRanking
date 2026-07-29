from collections.abc import Iterable

from app.models.ranking import RerankResult


class UnverifiableEvidenceError(ValueError):
    """Raised when a model response cites evidence outside the parsed document."""


def validate_evidence_references(result: RerankResult, valid_evidence_ids: Iterable[str]) -> None:
    valid = set(valid_evidence_ids)
    cited = {
        evidence.id
        for assessment in result.requirement_assessments
        for evidence in assessment.evidences
    }
    invalid = sorted(cited - valid)
    if invalid:
        raise UnverifiableEvidenceError(f"unknown evidence references: {', '.join(invalid)}")
