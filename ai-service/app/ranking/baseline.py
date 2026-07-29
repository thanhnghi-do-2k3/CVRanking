import re

from app.models.documents import Evidence
from app.models.mvp import (
    JobRequirement,
    RankedCandidate,
    RankingCandidate,
    RankingRequest,
    RankingResponse,
)
from app.models.ranking import EligibilityStatus, RequirementAssessment, RequirementStatus
from app.parsing.mvp import normalize_skill

MODEL_VERSION = "baseline-rules-v1"
FEATURE_SCHEMA_VERSION = "ranking-features-v1"


def _tokens(value: str) -> set[str]:
    return {
        token
        for token in re.findall(r"[\w+#.]+", value.casefold())
        if len(token) > 2 and token not in {"engineer", "developer", "manager"}
    }


def _assess(requirement: JobRequirement, candidate: RankingCandidate) -> RequirementAssessment:
    if requirement.requirement_type == "skill":
        expected = normalize_skill(requirement.name) or requirement.name.casefold()
        for skill in candidate.skills:
            actual = normalize_skill(skill.name) or skill.name.casefold()
            if actual == expected:
                if (
                    requirement.minimum_years is not None
                    and skill.estimated_years is not None
                    and skill.estimated_years < requirement.minimum_years
                ):
                    ratio = max(0.2, skill.estimated_years / requirement.minimum_years)
                    return RequirementAssessment(
                        requirement_id=requirement.requirement_key,
                        status=RequirementStatus.PARTIALLY_MET,
                        score=round(ratio, 4),
                        confidence=0.9,
                        evidences=skill.evidences,
                    )
                return RequirementAssessment(
                    requirement_id=requirement.requirement_key,
                    status=RequirementStatus.MET,
                    score=1,
                    confidence=0.95 if skill.evidences else 0.65,
                    evidences=skill.evidences,
                )
        return RequirementAssessment(
            requirement_id=requirement.requirement_key,
            status=RequirementStatus.NOT_FOUND,
            score=0,
            confidence=0.82,
            evidences=[],
        )

    if requirement.requirement_type == "experience":
        if candidate.total_years_experience is None:
            return RequirementAssessment(
                requirement_id=requirement.requirement_key,
                status=RequirementStatus.UNKNOWN,
                score=0.35,
                confidence=0.45,
                evidences=[],
            )
        minimum = requirement.minimum_years or 1
        ratio = min(1.0, candidate.total_years_experience / minimum)
        status = RequirementStatus.MET if ratio >= 1 else RequirementStatus.PARTIALLY_MET
        return RequirementAssessment(
            requirement_id=requirement.requirement_key,
            status=status,
            score=round(ratio, 4),
            confidence=0.8,
            evidences=[],
        )

    expected_tokens = _tokens(requirement.name)
    candidate_tokens = _tokens(candidate.current_title)
    if not candidate.current_title:
        return RequirementAssessment(
            requirement_id=requirement.requirement_key,
            status=RequirementStatus.UNKNOWN,
            score=0.3,
            confidence=0.4,
            evidences=[],
        )
    if not expected_tokens:
        similarity = 0.5
    else:
        similarity = len(expected_tokens & candidate_tokens) / len(expected_tokens)
    return RequirementAssessment(
        requirement_id=requirement.requirement_key,
        status=(
            RequirementStatus.MET
            if similarity >= 0.5
            else RequirementStatus.PARTIALLY_MET
            if similarity > 0
            else RequirementStatus.NOT_FOUND
        ),
        score=round(similarity, 4),
        confidence=0.7,
        evidences=[],
    )


def _evidence_excerpt(evidences: list[Evidence]) -> str:
    if not evidences:
        return ""
    value = evidences[0].text.replace("\n", " ").strip()
    return value[:180] + ("…" if len(value) > 180 else "")


def _score_candidate(
    requirements: list[JobRequirement], candidate: RankingCandidate
) -> RankedCandidate:
    assessments = [_assess(requirement, candidate) for requirement in requirements]
    total_weight = sum(requirement.weight for requirement in requirements)
    final_score = (
        sum(
            requirement.weight * assessment.score
            for requirement, assessment in zip(requirements, assessments, strict=True)
        )
        / total_weight
    )
    confidence = sum(assessment.confidence for assessment in assessments) / len(assessments)

    strengths: list[str] = []
    gaps: list[str] = []
    unknowns: list[str] = []
    hard_failed = False
    must_gap = False
    for requirement, assessment in zip(requirements, assessments, strict=True):
        if assessment.status == RequirementStatus.MET:
            excerpt = _evidence_excerpt(assessment.evidences)
            strengths.append(
                f"Đáp ứng {requirement.name}" + (f" — bằng chứng: “{excerpt}”" if excerpt else ".")
            )
        elif assessment.status == RequirementStatus.PARTIALLY_MET:
            gaps.append(f"Mới đáp ứng một phần yêu cầu {requirement.name}.")
            must_gap = must_gap or requirement.priority == "must_have"
        elif assessment.status in (RequirementStatus.UNKNOWN,):
            unknowns.append(f"CV chưa cung cấp đủ dữ liệu để xác minh {requirement.name}.")
            must_gap = must_gap or requirement.priority == "must_have"
        else:
            gaps.append(f"Chưa tìm thấy bằng chứng cho yêu cầu {requirement.name}.")
            must_gap = must_gap or requirement.priority == "must_have"
            hard_failed = hard_failed or requirement.is_hard_constraint

    eligibility = (
        EligibilityStatus.CONSTRAINT_FAILED
        if hard_failed
        else EligibilityStatus.POTENTIALLY_ELIGIBLE
        if must_gap
        else EligibilityStatus.ELIGIBLE
    )
    return RankedCandidate(
        candidate_id=candidate.candidate_id,
        rank=1,
        final_score=round(final_score, 6),
        confidence=round(confidence, 6),
        eligibility_status=eligibility,
        strengths=strengths,
        gaps=gaps,
        unknowns=unknowns,
        requirement_assessments=assessments,
        model_version=MODEL_VERSION,
        feature_schema_version=FEATURE_SCHEMA_VERSION,
    )


def rank_candidates(payload: RankingRequest) -> RankingResponse:
    results = [
        _score_candidate(payload.requirements, candidate) for candidate in payload.candidates
    ]
    results.sort(key=lambda item: (-item.final_score, -item.confidence, item.candidate_id))
    for rank, result in enumerate(results, start=1):
        result.rank = rank
    return RankingResponse(
        results=results,
        model_version=MODEL_VERSION,
        feature_schema_version=FEATURE_SCHEMA_VERSION,
    )
