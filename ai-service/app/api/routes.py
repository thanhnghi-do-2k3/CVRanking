from typing import Annotated

from fastapi import APIRouter, File, HTTPException, UploadFile

from app.config import Settings
from app.models.documents import CandidateExtraction
from app.models.mvp import (
    JobParseRequest,
    JobParseResult,
    RankingRequest,
    RankingResponse,
    ResumeAnalysis,
)
from app.parsing.mvp import analyze_resume, parse_job
from app.ranking.baseline import rank_candidates


def build_router(settings: Settings) -> APIRouter:
    router = APIRouter()

    @router.get("/healthz")
    async def health() -> dict[str, str]:
        return {"status": "ok", "service": settings.service_name, "version": settings.app_version}

    @router.get("/readyz")
    async def ready() -> dict[str, str]:
        return {"status": "ok", "service": settings.service_name, "version": settings.app_version}

    @router.post("/internal/v1/extractions/validate", response_model=CandidateExtraction)
    async def validate_extraction(payload: CandidateExtraction) -> CandidateExtraction:
        return payload

    @router.post("/internal/v1/jobs/parse", response_model=JobParseResult)
    async def parse_job_description(payload: JobParseRequest) -> JobParseResult:
        return parse_job(payload)

    @router.post("/internal/v1/documents/analyze", response_model=ResumeAnalysis)
    async def analyze_document(file: Annotated[UploadFile, File()]) -> ResumeAnalysis:
        data = await file.read()
        if not data:
            raise HTTPException(status_code=422, detail="the uploaded file is empty")
        if len(data) > 10 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="the uploaded file exceeds 10 MiB")
        try:
            return analyze_resume(
                file.filename or "resume",
                file.content_type or "application/octet-stream",
                data,
            )
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error

    @router.post("/internal/v1/rankings/score", response_model=RankingResponse)
    async def score_candidates(payload: RankingRequest) -> RankingResponse:
        return rank_candidates(payload)

    return router
