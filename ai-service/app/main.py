import re
import secrets
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI, Request, Response
from opentelemetry import trace
from opentelemetry.trace import Status, StatusCode

from app.api.routes import build_router
from app.config import get_settings
from app.telemetry import configure_telemetry

settings = get_settings()

structlog.configure(
    processors=[
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        structlog.processors.JSONRenderer(),
    ]
)
logger = structlog.get_logger(settings.service_name)
safe_header = re.compile(r"^[\x21-\x7e]{1,128}$")


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    shutdown_telemetry = configure_telemetry(settings)
    logger.info("service_started", version=settings.app_version)
    yield
    shutdown_telemetry()
    logger.info("service_stopped")


app = FastAPI(
    title="TalentRank AI Service",
    version=settings.app_version,
    docs_url="/docs" if settings.app_env != "production" else None,
    redoc_url=None,
    lifespan=lifespan,
)


def identity(value: str | None) -> str:
    if value and safe_header.fullmatch(value):
        return value
    return secrets.token_hex(16)


@app.middleware("http")
async def request_context(request: Request, call_next) -> Response:
    request_id = identity(request.headers.get("x-request-id"))
    correlation_id = identity(request.headers.get("x-correlation-id") or request_id)
    started = time.perf_counter()
    tracer = trace.get_tracer(settings.service_name)

    structlog.contextvars.clear_contextvars()
    structlog.contextvars.bind_contextvars(
        request_id=request_id,
        correlation_id=correlation_id,
    )
    with tracer.start_as_current_span(f"{request.method} {request.url.path}") as span:
        try:
            response = await call_next(request)
        except Exception:
            span.set_status(Status(StatusCode.ERROR))
            logger.exception(
                "http_request_failed",
                method=request.method,
                path=request.url.path,
            )
            raise
        response.headers["X-Request-ID"] = request_id
        response.headers["X-Correlation-ID"] = correlation_id
        span.set_attribute("http.request.method", request.method)
        span.set_attribute("url.path", request.url.path)
        span.set_attribute("http.response.status_code", response.status_code)
        logger.info(
            "http_request",
            method=request.method,
            path=request.url.path,
            status=response.status_code,
            duration_ms=round((time.perf_counter() - started) * 1000, 2),
        )
        return response


app.include_router(build_router(settings))
