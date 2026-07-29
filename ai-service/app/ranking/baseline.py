import re
from collections.abc import Callable

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

MODEL_VERSION = "baseline-rules-v2"
FEATURE_SCHEMA_VERSION = "ranking-features-v2"

RELATED_SKILLS: dict[str, tuple[str, ...]] = {
    "React": ("Next.js",),
    "Next.js": ("React",),
    "Node.js": ("JavaScript", "TypeScript"),
    "TypeScript": ("JavaScript",),
    "Django": ("Python", "Flask"),
    "Flask": ("Python", "Django"),
    "FastAPI": ("Python",),
    "Kubernetes": ("Docker",),
    "Docker": ("Kubernetes",),
    "PostgreSQL": ("SQL", "MySQL"),
    "MySQL": ("SQL", "PostgreSQL"),
    "AWS": ("Azure", "GCP"),
    "Azure": ("AWS", "GCP"),
    "GCP": ("AWS", "Azure"),
    "Spring Boot": ("Java",),
    "Gin": ("Go",),
    "Chi": ("Go",),
    "PyTorch": ("Machine Learning", "Python"),
    "TensorFlow": ("Machine Learning", "Python"),
    "Machine Learning": ("Python",),
    "NLP": ("Machine Learning", "Python"),
}
RELATED_SKILL_CREDIT = 0.55

PROFICIENCY_SCORES: dict[str, float] = {
    "native": 1.0,
    "fluent": 1.0,
    "thành thạo": 0.9,
    "trôi chảy": 0.9,
    "advanced": 0.9,
    "proficient": 0.85,
    "professional working proficiency": 0.85,
    "khá tốt": 0.65,
    "giao tiếp tốt": 0.6,
    "intermediate": 0.6,
    "khá": 0.6,
    "giao tiếp": 0.5,
    "elementary": 0.35,
    "cơ bản": 0.3,
    "basic": 0.3,
}


def _tokens(value: str) -> set[str]:
    return {
        token
        for token in re.findall(r"[\w+#.]+", value.casefold())
        if len(token) > 2 and token not in {"engineer", "developer", "manager"}
    }


def _language_score(proficiency: str) -> float:
    lowered = proficiency.casefold()
    for keyword, value in PROFICIENCY_SCORES.items():
        if keyword in lowered:
            return value
    ielts_match = re.search(r"ielts\s*([\d.]+)", lowered)
    if ielts_match:
        return round(min(1.0, float(ielts_match.group(1)) / 9.0), 4)
    toeic_match = re.search(r"toeic\s*(\d+)", lowered)
    if toeic_match:
        return round(min(1.0, float(toeic_match.group(1)) / 990.0), 4)
    return 0.55 if proficiency else 0.5


def _best_token_match[T](
    expected_tokens: set[str], candidates: list[T], text_for: Callable[[T], str]
) -> tuple[T | None, float]:
    best: T | None = None
    best_score = 0.0
    for candidate in candidates:
        candidate_tokens = _tokens(text_for(candidate))
        overlap = (
            len(expected_tokens & candidate_tokens) / len(expected_tokens)
            if expected_tokens
            else 0.5
        )
        if overlap > best_score:
            best_score = overlap
            best = candidate
    return best, best_score


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
        related_names = RELATED_SKILLS.get(expected, ())
        if related_names:
            for skill in candidate.skills:
                actual = normalize_skill(skill.name) or skill.name.casefold()
                if actual in related_names:
                    return RequirementAssessment(
                        requirement_id=requirement.requirement_key,
                        status=RequirementStatus.PARTIALLY_MET,
                        score=RELATED_SKILL_CREDIT,
                        confidence=0.55,
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
        raw_ratio = candidate.total_years_experience / minimum
        if raw_ratio >= 1:
            # Diminishing bonus above the threshold instead of a hard score=1 cliff.
            score = min(1.0, 0.92 + 0.08 * min(1.0, raw_ratio - 1))
            status = RequirementStatus.MET
        else:
            # Concave curve: partial experience is worth more than a linear ratio would give.
            score = raw_ratio**0.6
            status = RequirementStatus.PARTIALLY_MET
        return RequirementAssessment(
            requirement_id=requirement.requirement_key,
            status=status,
            score=round(score, 4),
            confidence=0.8,
            evidences=[],
        )

    if requirement.requirement_type == "education":
        if not candidate.educations:
            return RequirementAssessment(
                requirement_id=requirement.requirement_key,
                status=RequirementStatus.UNKNOWN,
                score=0.3,
                confidence=0.4,
                evidences=[],
            )
        expected_tokens = _tokens(requirement.name) | _tokens(requirement.description)
        best, score = _best_token_match(
            expected_tokens,
            candidate.educations,
            lambda education: (
                f"{education.degree} {education.field_of_study} {education.institution}"
            ),
        )
        status = (
            RequirementStatus.MET
            if score >= 0.5
            else RequirementStatus.PARTIALLY_MET
            if score > 0
            else RequirementStatus.NOT_FOUND
        )
        return RequirementAssessment(
            requirement_id=requirement.requirement_key,
            status=status,
            score=round(score, 4),
            confidence=0.75 if best else 0.5,
            evidences=best.evidences if best else [],
        )

    if requirement.requirement_type == "certification":
        if not candidate.certifications:
            return RequirementAssessment(
                requirement_id=requirement.requirement_key,
                status=RequirementStatus.UNKNOWN,
                score=0.3,
                confidence=0.4,
                evidences=[],
            )
        expected_tokens = _tokens(requirement.name) | _tokens(requirement.description)
        best, score = _best_token_match(
            expected_tokens,
            candidate.certifications,
            lambda certification: f"{certification.name} {certification.issuer}",
        )
        status = (
            RequirementStatus.MET
            if score >= 0.5
            else RequirementStatus.PARTIALLY_MET
            if score > 0
            else RequirementStatus.NOT_FOUND
        )
        return RequirementAssessment(
            requirement_id=requirement.requirement_key,
            status=status,
            score=round(score, 4),
            confidence=0.75 if best else 0.5,
            evidences=best.evidences if best else [],
        )

    if requirement.requirement_type == "language":
        expected_tokens = _tokens(requirement.name)
        matched_language = next(
            (
                language
                for language in candidate.languages
                if _tokens(language.language) & expected_tokens
            ),
            None,
        )
        if matched_language is None:
            return RequirementAssessment(
                requirement_id=requirement.requirement_key,
                status=(
                    RequirementStatus.NOT_FOUND
                    if candidate.languages
                    else RequirementStatus.UNKNOWN
                ),
                score=0.0 if candidate.languages else 0.3,
                confidence=0.7 if candidate.languages else 0.4,
                evidences=[],
            )
        score = _language_score(matched_language.proficiency)
        status = (
            RequirementStatus.MET
            if score >= 0.6
            else RequirementStatus.PARTIALLY_MET
            if score > 0
            else RequirementStatus.NOT_FOUND
        )
        return RequirementAssessment(
            requirement_id=requirement.requirement_key,
            status=status,
            score=round(score, 4),
            confidence=0.8,
            evidences=matched_language.evidences,
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
