from fastapi.testclient import TestClient

from app.main import app


def test_health_returns_service_metadata_and_ids() -> None:
    with TestClient(app) as client:
        response = client.get("/healthz", headers={"X-Correlation-ID": "test-correlation"})

    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.headers["X-Request-ID"]
    assert response.headers["X-Correlation-ID"] == "test-correlation"


def test_invalid_identity_header_is_replaced() -> None:
    with TestClient(app) as client:
        response = client.get("/healthz", headers={"X-Request-ID": "bad identity"})

    assert response.status_code == 200
    assert response.headers["X-Request-ID"] != "bad identity"
