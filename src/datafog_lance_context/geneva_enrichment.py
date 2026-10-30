"""Training-row ingestion with DataFog inside the MLE-owned Geneva UDF."""
import importlib.metadata
import inspect
import os
import time
from typing import Iterator, NamedTuple, Optional
from uuid import uuid4

import geneva
from geneva import chunker
import pyarrow as pa
import ray
from datafog_core import scan

from .enrichment import FIXTURES


class TrainingRow(NamedTuple):
    chunk_index: int
    text: str
    has_pii: bool
    pii_types: list[str]


@chunker(version="training-ingestion-v2", num_cpus=0.25)
def prepare_training_rows(raw_text: Optional[str]) -> Iterator[TrainingRow]:
    if raw_text is None:
        raise ValueError("Missing document text; ingestion cannot continue.")
    for chunk_index, paragraph in enumerate(raw_text.split("\n\n")):
        text = paragraph.strip()
        if not text:
            continue
        # DataFog runs inside the MLE's existing row preparation function.
        findings = scan(text, {"entities": ["EMAIL", "PHONE", "SSN", "CREDIT_CARD"]})
        yield TrainingRow(
            chunk_index=chunk_index,
            text=text,
            has_pii=bool(findings),
            pii_types=sorted({item.entity_type for item in findings}),
        )


def ingest_training_data(db, source, table_name, new_files):
    source.add(new_files)
    training = db.create_udtf_view(
        table_name,
        source=source.search().select(["asset_id", "source_uri", "split", "raw_text"]),
        udtf=prepare_training_rows,
    )
    job = training.refresh_async(src_version=source.version, concurrency=1)
    job.result(timeout=180)
    training.checkout_latest()
    return training, job


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
             "split": "train", "raw_text": text} for asset_id, path, text in FIXTURES]
    source = db.create_table('documents_' + uuid4().hex, schema=pa.Table.from_pylist(rows).schema)
    source_schema = str(source.schema)
    source_version = source.version
    # CPU and memory reservations fit the single standard-2 demo instance.
    # Workers inherit this image's pinned dependencies; no runtime pip installs.
    ray.init(num_cpus=1, object_store_memory=200 * 1024 * 1024,
             resources={"geneva_ray_head": 1}, include_dashboard=False,
             log_to_driver=False)
    try:
        with db.local_ray_context():
            table, job = ingest_training_data(db, source, table_name, rows)
            source_version = source.version
            selected = table.search().where("has_pii = false").select(["asset_id", "chunk_index"]).limit(100).to_arrow().to_pylist()
            output = table.search().select(["asset_id", "source_uri", "split", "chunk_index", "has_pii", "pii_types"]).limit(100).to_arrow().sort_by("asset_id").to_pylist()
            if {row["asset_id"] for row in output} != {row["asset_id"] for row in rows}:
                raise RuntimeError("Ingestion did not produce rows for every input document.")
            if any(row["has_pii"] is None or row["pii_types"] is None for row in output):
                raise RuntimeError("Ingestion produced incomplete PII metadata.")
            return {"rows": output, "source_schema": source_schema,
                    "schema": str(pa.schema([pa.field(field.name, field.type) for field in table.schema if not field.name.startswith("__")])), "source_version": source_version,
                    "version": table.version, "table_name": table_name,
                    "flagged": sum(row["has_pii"] for row in output),
                    "selected_ids": sorted({row["asset_id"] for row in selected}),
                    "selected_keys": sorted(f"{row['asset_id']}:{row['chunk_index']}" for row in selected),
                    "duration_ms": round((time.perf_counter() - started) * 1000),
                    "versions": {name: importlib.metadata.version(package) for name, package in
                                 [("lancedb", "lancedb"), ("geneva", "geneva"), ("datafog_core", "datafog-core")]},
                    "input_rows": len(rows), "output_schema": str(prepare_training_rows.output_schema),
                    "job_id": job.job_id, "job_status": job.status,
                    "udf": inspect.getsource(TrainingRow) + "\n\n" + inspect.getsource(prepare_training_rows.func),
                    "pipeline": inspect.getsource(ingest_training_data),
                    "execution": "Self-hosted Geneva · Cloudflare Ray runtime · R2 tables" if uri.startswith("s3://") else "Geneva · local development table"}
    finally:
        ray.shutdown()
