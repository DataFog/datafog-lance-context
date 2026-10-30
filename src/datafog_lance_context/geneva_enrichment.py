"""Real Geneva column registration and backfill over an object-storage table."""
import importlib.metadata
import inspect
import os
import time
from typing import NamedTuple, Optional
from uuid import uuid4

import geneva
from geneva import Columns, udf
import pyarrow as pa
import ray
from datafog_core import scan

from .enrichment import FIXTURES


class PIIColumns(NamedTuple):
    has_PII: bool
    pii_types: list[str]


@udf(version="datafog-core-0.5.0b3", num_cpus=0.25)
def detect_pii(text: Optional[str]) -> Columns[PIIColumns]:
    if text is None:
        raise ValueError("Missing extracted text; do not mark this row clean.")
    findings = scan(text, {"entities": ["EMAIL", "PHONE", "SSN", "CREDIT_CARD"]})
    return PIIColumns(bool(findings), sorted({item.entity_type for item in findings}))


def register_and_backfill(table):
    table.add_columns(detect_pii)
    job = table.backfill_async("has_PII", concurrency=1)
    job.result(timeout=180)
    table.checkout_latest()
    return job


def run_geneva_enrichment(database_uri: str | None = None) -> dict:
    started = time.perf_counter()
    uri = database_uri or os.environ["GENEVA_DATABASE_URI"]
    options = {
        "aws_access_key_id": "internal-container",
        "aws_secret_access_key": "internal-container",
        "aws_region": "auto",
        "aws_endpoint": os.environ.get("GENEVA_STORAGE_ENDPOINT", "http://r2.internal"),
        "aws_allow_http": "true",
        "aws_virtual_hosted_style_request": "false",
    } if uri.startswith("s3://") else None
    db = geneva.connect(uri, storage_options=options)
    table_name = "training_data_" + uuid4().hex
    rows = [{"asset_id": asset_id,
             "source_uri": f"s3://datafog-lance-geneva-demo/synthetic/{path}",
             "split": "train", "text": text} for asset_id, path, text in FIXTURES]
    table = db.create_table(table_name, pa.Table.from_pylist(rows))
    source_schema = str(table.schema)
    source_version = table.version
    # CPU and memory reservations fit the single standard-2 demo instance.
    # Workers inherit this image's pinned dependencies; no runtime pip installs.
    ray.init(num_cpus=1, object_store_memory=200 * 1024 * 1024,
             resources={"geneva_ray_head": 1}, include_dashboard=False,
             log_to_driver=False)
    try:
        with db.local_ray_context():
            job = register_and_backfill(table)
            selected = table.search().where("has_PII = false").select(["asset_id"]).limit(100).to_arrow().to_pylist()
            output = table.search().select(["asset_id", "source_uri", "split", "has_PII", "pii_types"]).limit(100).to_arrow().sort_by("asset_id").to_pylist()
            if any(row["has_PII"] is None or row["pii_types"] is None for row in output):
                raise RuntimeError("Backfill left unscanned rows.")
            return {"rows": output, "source_schema": source_schema,
                    "schema": str(pa.schema([pa.field(field.name, field.type) for field in table.schema])), "source_version": source_version,
                    "version": table.version, "table_name": table_name,
                    "flagged": sum(row["has_PII"] for row in output),
                    "selected_ids": sorted(row["asset_id"] for row in selected),
                    "duration_ms": round((time.perf_counter() - started) * 1000),
                    "versions": {name: importlib.metadata.version(package) for name, package in
                                 [("lancedb", "lancedb"), ("geneva", "geneva"), ("datafog_core", "datafog-core")]},
                    "job_id": job.job_id, "job_status": job.status,
                    "udf": inspect.getsource(PIIColumns) + "\n\n" + inspect.getsource(detect_pii.func),
                    "pipeline": inspect.getsource(register_and_backfill),
                    "execution": "Self-hosted Geneva · Cloudflare Ray runtime · R2 tables" if uri.startswith("s3://") else "Geneva · local development table"}
    finally:
        ray.shutdown()
