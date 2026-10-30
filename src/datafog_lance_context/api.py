"""Same-origin API for the public synthetic-data demonstration."""

from __future__ import annotations

from pathlib import Path
import os
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, StrictBool, StrictStr

from .pipeline import DemoError, DemoStore, MAX_UPLOAD_BYTES, SUPPORTED_ENTITIES, versions


class ImportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    content: StrictStr
    filename: StrictStr = "conversations.jsonl"


class RunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    dataset_id: StrictStr
    policy: dict[str, Any] | None = None
    inject_failure: StrictBool = False


def create_app(store: DemoStore | None = None) -> FastAPI:
    app = FastAPI(title="DataFog × Lance Context", docs_url=None, redoc_url=None)
    app.state.store = store or DemoStore()

    @app.exception_handler(DemoError)
    async def demo_error(_: Request, error: DemoError) -> JSONResponse:
        return JSONResponse({"error": {"code": error.code, "message": error.message}}, status_code=error.status_code)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, __: RequestValidationError) -> JSONResponse:
        return JSONResponse({"error": {"code": "invalid_request", "message": "The request does not match the supported input schema."}}, status_code=422)

    @app.exception_handler(Exception)
    async def unexpected_error(_: Request, __: Exception) -> JSONResponse:
        return JSONResponse({"error": {"code": "internal_error", "message": "The request could not complete. Retry the sample file."}}, status_code=500)

    @app.middleware("http")
    async def response_headers(request: Request, call_next: Any) -> Any:
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.get("/api/health")
    def health() -> dict[str, Any]:
        return {"status": "ok", "versions": versions(), "capabilities": {
            "real_lance_context": True, "real_datafog_core": True, "format": "sft",
            "entities": sorted(SUPPORTED_ENTITIES), "max_upload_bytes": MAX_UPLOAD_BYTES,
            "temporary_state": True, "synthetic_data_only": True,
        }}

    @app.post("/api/enrichment")
    def enrichment() -> dict[str, Any]:
        from .enrichment import RUN_LOCK, run_enrichment
        with RUN_LOCK:
            return run_enrichment()

    @app.get("/api/sample")
    def sample() -> FileResponse:
        root = Path(__file__).resolve().parents[2]
        for path in (Path(os.environ.get("DEMO_DATA_DIR", str(Path.cwd() / "data"))) / "support-conversations-v1.jsonl", root / "data/support-conversations-v1.jsonl", root / "ui/public/samples/support-conversations-v1.jsonl"):
            if path.is_file():
                return FileResponse(path, media_type="application/x-ndjson", filename="support-conversations-v1.jsonl")
        raise DemoError("sample_unavailable", "Use the public sample link or select a local synthetic JSONL file.", 404)

    @app.post("/api/datasets")
    def import_dataset(body: ImportRequest) -> dict[str, Any]:
        return app.state.store.import_dataset(body.content, body.filename)

    @app.post("/api/runs")
    def run(body: RunRequest) -> dict[str, Any]:
        return app.state.store.run_export(body.dataset_id, body.policy, body.inject_failure)

    @app.get("/api/runs/{run_id}/bundle")
    def bundle(run_id: str) -> FileResponse:
        return FileResponse(app.state.store.release_file(run_id, "release.zip"), media_type="application/zip", filename="datafog-training-release.zip")

    @app.get("/api/runs/{run_id}/receipt")
    def receipt(run_id: str) -> FileResponse:
        return FileResponse(app.state.store.release_file(run_id, "receipt.json"), media_type="application/json", filename="receipt.json")

    @app.get("/api/runs/{run_id}/training")
    def training(run_id: str) -> FileResponse:
        return FileResponse(app.state.store.release_file(run_id, "training.jsonl"), media_type="application/x-ndjson", filename="training.jsonl")

    static = Path.cwd() / "ui/dist"
    if static.is_dir():
        app.mount("/", StaticFiles(directory=static, html=True), name="ui")
    return app


app = create_app()

