from collections.abc import Callable

from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import SERVICE_NAME, SERVICE_VERSION, Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

from app.config import Settings


def configure_telemetry(settings: Settings) -> Callable[[], None]:
    if not settings.otel_exporter_otlp_endpoint:
        return lambda: None

    provider = TracerProvider(
        resource=Resource.create(
            {SERVICE_NAME: settings.service_name, SERVICE_VERSION: settings.app_version}
        )
    )
    exporter = OTLPSpanExporter(
        endpoint=f"{settings.otel_exporter_otlp_endpoint.rstrip('/')}/v1/traces"
    )
    provider.add_span_processor(BatchSpanProcessor(exporter))
    trace.set_tracer_provider(provider)
    return provider.shutdown
