"""The same real export-and-transform pipeline powers the API and CLI.

Raw Lance artifacts stay in private staging. A separate, documented SFT release
schema contains only messages and an optional numeric reward. The receipt has
opaque references; it never copies Lance's raw lineage manifest.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
import hashlib
from importlib.metadata import version
import json
import math
import os
from pathlib import Path
import shutil
import tempfile
import threading
import time
from typing import Any
import uuid
import zipfile

from datafog_core import scan_and_transform
from lance_context import Context

SUPPORTED_ENTITIES = frozenset({"EMAIL", "PHONE", "SSN", "CREDIT_CARD", "IP_ADDRESS", "DATE", "ZIP_CODE"})
DEFAULT_ENTITIES = ["EMAIL", "PHONE", "SSN", "CREDIT_CARD"]
ROLES = frozenset({"system", "user", "assistant", "tool"})
PUBLIC_SUPPORT_EMAIL = "support@example.com"
# This public container loads a full Lance source scan in memory. Keep each
# upload small; operators can set a lower bound for their deployment allocation.
MAX_UPLOAD_BYTES = int(os.environ.get("MAX_UPLOAD_BYTES", str(2 * 1024 * 1024)))
SESSION_IDLE_SECONDS = int(os.environ.get("SESSION_IDLE_SECONDS", "900"))
MAX_DATASETS = int(os.environ.get("MAX_DATASETS", "8"))
MAX_RUNS = int(os.environ.get("MAX_RUNS", "32"))
MAX_RETAINED_BYTES = int(os.environ.get("MAX_RETAINED_BYTES", str(16 * 1024 * 1024)))


class DemoError(Exception):
    """An error safe to display: never attach input text or native errors."""

    def __init__(self, code: str, message: str, status_code: int = 422):
        self.code = code
        self.message = message
        self.status_code = status_code
        super().__init__(message)


def versions() -> dict[str, str]:
    return {"lance_context": version("lance-context"), "datafog_core": version("datafog-core"), "adapter": "0.1.0"}


def canonical(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def digest(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _reject_constant(_: str) -> None:
    raise ValueError("Nonfinite number")


def is_finite_reward(value: Any) -> bool:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        return False


def validate_upload(content: str) -> list[dict[str, Any]]:
    if not isinstance(content, str) or not content.strip():
        raise DemoError("empty_upload", "Choose a non-empty synthetic JSONL file.")
    try:
        content_bytes = content.encode("utf-8")
    except UnicodeEncodeError:
        raise DemoError("invalid_unicode", "The file must contain valid UTF-8 text.") from None
    if len(content_bytes) > MAX_UPLOAD_BYTES:
        raise DemoError("upload_too_large", f"This public demo accepts files up to {MAX_UPLOAD_BYTES // 1024} KiB.", 413)
    conversations = []
    sessions: set[str] = set()
    # JSONL uses LF record boundaries; Unicode separators are valid string text.
    for line_number, line in enumerate(content.lstrip("\ufeff").split("\n"), 1):
        if not line.strip():
            continue
        prefix = f"Row {line_number}: "
        try:
            row = json.loads(line, parse_constant=_reject_constant)
        except (ValueError, TypeError, RecursionError):
            raise DemoError("invalid_json", prefix + "expected one valid JSON object per line.") from None
        if not isinstance(row, dict):
            raise DemoError("invalid_conversation", prefix + "expected a conversation object.")
        if row.get("schema_version", "1") != "1":
            raise DemoError("unsupported_schema", prefix + "only conversation schema version 1 is supported.")
        session_id = row.get("session_id")
        if not isinstance(session_id, str) or not session_id.strip():
            raise DemoError("invalid_session", prefix + "session_id must be a non-empty string.")
        if session_id in sessions:
            raise DemoError("duplicate_session", prefix + "session_id must be unique within the upload.")
        sessions.add(session_id)
        try:
            session_id.encode("utf-8")
        except UnicodeEncodeError:
            raise DemoError("invalid_unicode", prefix + "session_id must contain valid UTF-8 text.") from None
        messages = row.get("messages")
        if not isinstance(messages, list) or not messages:
            raise DemoError("invalid_messages", prefix + "messages must be a non-empty array.")
        normalized_messages = []
        for index, message in enumerate(messages, 1):
            if not isinstance(message, dict) or not isinstance(message.get("role"), str) or message["role"] not in ROLES or not isinstance(message.get("content"), str):
                raise DemoError("invalid_message", prefix + f"message {index} needs a supported role and string content.")
            try:
                message["content"].encode("utf-8")
            except UnicodeEncodeError:
                raise DemoError("invalid_unicode", prefix + f"message {index} must contain valid UTF-8 text.") from None
            normalized_messages.append({"role": message["role"], "content": message["content"]})
        for name in ("tenant", "source", "external_id"):
            if name in row and row[name] is not None and not isinstance(row[name], str):
                raise DemoError("invalid_metadata", prefix + f"{name} must be a string or null.")
            if isinstance(row.get(name), str):
                try:
                    row[name].encode("utf-8")
                except UnicodeEncodeError:
                    raise DemoError("invalid_unicode", prefix + f"{name} must contain valid UTF-8 text.") from None
        metadata = row.get("metadata", {})
        if not isinstance(metadata, dict):
            raise DemoError("invalid_metadata", prefix + "metadata must be an object.")
        try:
            canonical(metadata).encode("utf-8")
        except (ValueError, TypeError, RecursionError, UnicodeEncodeError):
            raise DemoError("invalid_metadata", prefix + "metadata must contain finite JSON values.") from None
        if "reward" in metadata and not is_finite_reward(metadata["reward"]):
            raise DemoError("invalid_reward", prefix + "reward must be a finite number.")
        conversations.append({
            "schema_version": "1", "session_id": session_id,
            "tenant": row.get("tenant") or "synthetic-demo", "source": row.get("source") or "synthetic-support",
            "external_id": row.get("external_id"), "messages": normalized_messages, "metadata": metadata,
        })
    if not conversations:
        raise DemoError("empty_upload", "No conversations were found in the JSONL file.")
    return conversations


def validate_policy(value: dict[str, Any] | None) -> dict[str, Any]:
    value = value or {}
    entities = value.get("entities", DEFAULT_ENTITIES)
    if not isinstance(entities, list) or not entities or any(not isinstance(x, str) or x not in SUPPORTED_ENTITIES for x in entities):
        raise DemoError("invalid_policy", "Select at least one supported PII type.")
    if not isinstance(value.get("allow_support_email", True), bool):
        raise DemoError("invalid_policy", "The support-email exception must be true or false.")
    return {"entities": sorted(set(entities)), "allow_support_email": value.get("allow_support_email", True), "strategy": "redact", "metadata": "omit_raw_lineage_v1"}


def core_config(policy: dict[str, Any]) -> dict[str, Any]:
    config: dict[str, Any] = {"default": {"strategy": "redact"}, "entities": policy["entities"]}
    if policy["allow_support_email"]:
        config["allow"] = {"exact": {"EMAIL": [PUBLIC_SUPPORT_EMAIL]}}
    return {"transform": config}


@dataclass
class Dataset:
    dataset_id: str
    context: Context
    directory: Path
    source_version: int
    conversations: list[dict[str, Any]]
    filename: str
    content_hash: str
    cached_bytes: int
    last_used: float = field(default_factory=time.monotonic)
    lock: threading.RLock = field(default_factory=threading.RLock)


@dataclass
class Run:
    response: dict[str, Any]
    release_dir: Path | None = None
    last_used: float = field(default_factory=time.monotonic)

    @property
    def cached_bytes(self) -> int:
        return len(canonical(self.response).encode("utf-8"))


class DemoStore:
    def __init__(self, root: Path | None = None):
        self.root = root or Path(tempfile.mkdtemp(prefix="datafog-lance-demo-"))
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.datasets: dict[str, Dataset] = {}
        self.runs: dict[str, Run] = {}
        self.lock = threading.RLock()
        self.processing_lock = threading.RLock()

    def prune(self) -> None:
        """Expire idle state and bound retained public-demo objects with LRU eviction."""
        now = time.monotonic()
        with self.lock:
            expired_datasets = [key for key, value in self.datasets.items() if now - value.last_used > SESSION_IDLE_SECONDS]
            while len(self.datasets) - len(expired_datasets) > MAX_DATASETS:
                candidates = [(value.last_used, key) for key, value in self.datasets.items() if key not in expired_datasets]
                expired_datasets.append(min(candidates)[1])
            for key in expired_datasets:
                dataset = self.datasets.pop(key)
                with dataset.lock:
                    shutil.rmtree(dataset.directory, ignore_errors=True)
            expired_runs = [key for key, value in self.runs.items() if now - value.last_used > SESSION_IDLE_SECONDS]
            while len(self.runs) - len(expired_runs) > MAX_RUNS:
                candidates = [(value.last_used, key) for key, value in self.runs.items() if key not in expired_runs]
                expired_runs.append(min(candidates)[1])
            for key in expired_runs:
                run = self.runs.pop(key)
                if run.release_dir:
                    shutil.rmtree(run.release_dir, ignore_errors=True)
            while sum(item.cached_bytes for item in self.datasets.values()) + sum(item.cached_bytes for item in self.runs.values()) > MAX_RETAINED_BYTES:
                candidates = [(item.last_used, "dataset", key) for key, item in self.datasets.items()] + [(item.last_used, "run", key) for key, item in self.runs.items()]
                _, kind, key = min(candidates)
                if kind == "dataset":
                    item = self.datasets.pop(key)
                    shutil.rmtree(item.directory, ignore_errors=True)
                else:
                    run = self.runs.pop(key)
                    if run.release_dir:
                        shutil.rmtree(run.release_dir, ignore_errors=True)

    def import_dataset(self, content: str, filename: str = "conversations.jsonl") -> dict[str, Any]:
        with self.processing_lock:
            return self._import_dataset(content, filename)

    def _import_dataset(self, content: str, filename: str) -> dict[str, Any]:
        self.prune()
        conversations = validate_upload(content)
        dataset_id = uuid.uuid4().hex
        directory = self.root / dataset_id
        directory.mkdir(mode=0o700)
        try:
            context = Context.create(str(directory / "context.lance"))
            records = []
            turn = 0
            base = datetime(2026, 1, 1, tzinfo=timezone.utc)
            for conversation in conversations:
                for message in conversation["messages"]:
                    records.append({
                        "role": message["role"], "content": message["content"],
                        "session_id": conversation["session_id"], "tenant": conversation["tenant"],
                        "source": conversation["source"],
                        # Context external IDs are unique per record; input IDs identify a conversation.
                        "external_id": f"{conversation['external_id']}#turn-{turn}" if conversation["external_id"] else None,
                        "metadata": conversation["metadata"],
                        "created_at": base + timedelta(seconds=turn),
                    })
                    turn += 1
            context.add_many(records)
            dataset = Dataset(dataset_id, context, directory, context.version(), conversations, Path(filename).name, digest(content.encode("utf-8")), len(canonical(conversations).encode("utf-8")))
        except Exception:
            shutil.rmtree(directory, ignore_errors=True)
            raise DemoError("import_failed", "The Lance import could not complete. Please try the sample file.", 500) from None
        with self.lock:
            self.datasets[dataset_id] = dataset
        self.prune()
        return {"dataset_id": dataset_id, "source_version": dataset.source_version,
                "conversation_count": len(conversations), "message_count": turn,
                "conversations": conversations, "filename": dataset.filename, "versions": versions()}

    def run_export(self, dataset_id: str, policy_value: dict[str, Any] | None = None, inject_failure: bool = False) -> dict[str, Any]:
        with self.processing_lock:
            return self._run_export(dataset_id, policy_value, inject_failure)

    def _run_export(self, dataset_id: str, policy_value: dict[str, Any] | None, inject_failure: bool) -> dict[str, Any]:
        self.prune()
        policy = validate_policy(policy_value)
        with self.lock:
            dataset = self.datasets.get(dataset_id)
        if dataset is None:
            raise DemoError("session_expired", "This temporary source is no longer available. Import the file again.", 404)
        dataset.last_used = time.monotonic()
        run_id = uuid.uuid4().hex
        started = time.perf_counter()
        policy_hash = digest(canonical(policy).encode())
        summary: dict[str, Any] = {"examples": 0, "messages": 0, "replacements": 0, "examples_changed": 0,
                                   "by_entity": {}, "duration_ms": 0, "source_version": dataset.source_version,
                                   "policy_hash": policy_hash, "versions": versions()}
        response: dict[str, Any] = {"run_id": run_id, "status": "blocked", "summary": summary,
                                    "examples": [], "metadata_review": [], "receipt": None, "download_url": None}
        staging = dataset.directory / ("run-" + run_id)
        staging.mkdir(mode=0o700)
        raw_dir, clean_dir = staging / "private", staging / "clean"
        raw_dir.mkdir(mode=0o700)
        clean_dir.mkdir(mode=0o700)
        release_dir = self.root / ("release-" + run_id)
        try:
            with dataset.lock:
                manifest = dataset.context.export_training(str(raw_dir / "training.jsonl"), task="sft", group_by="session_id", version=dataset.source_version, emit_stats=True)
                if dataset.context.version() != dataset.source_version:
                    raise DemoError("source_changed", "The source snapshot changed. Reimport before exporting.")
            raw_examples = [json.loads(line) for line in (raw_dir / "training.jsonl").read_text().split("\n") if line.strip()]
            if len(raw_examples) != manifest["counts"]["examples"]:
                raise DemoError("export_invalid", "The Lance export did not match its manifest.")
            if sum(len(item.get("messages", [])) for item in raw_examples) != sum(len(item["messages"]) for item in dataset.conversations):
                raise DemoError("snapshot_incomplete", "The pinned export did not contain all imported messages. No release was published.")
            transformed = []
            by_entity: Counter[str] = Counter()
            config = core_config(policy)
            metadata_review: list[dict[str, Any]] = []
            for index, raw in enumerate(raw_examples):
                if not isinstance(raw.get("messages"), list):
                    raise DemoError("unsupported_export", "The exported training format is not supported.")
                clean: dict[str, Any] = {"messages": []}
                changes = []
                for message_index, message in enumerate(raw["messages"]):
                    if message.get("role") not in ROLES or not isinstance(message.get("content"), str):
                        raise DemoError("unsupported_export", "An exported message did not match the supported schema.")
                    result = scan_and_transform(message["content"], config)
                    clean["messages"].append({"role": message["role"], "content": result.text})
                    for item in result.transformations:
                        by_entity[item.entity_type] += 1
                        changes.append({"message_index": message_index, "entity_type": item.entity_type,
                                        "start": item.source_codepoint_range.start, "end": item.source_codepoint_range.end,
                                        "output_start": item.output_codepoint_range.start, "output_end": item.output_codepoint_range.end,
                                        "replacement": item.replacement, "detector_name": item.detector_name,
                                        "detector_version": item.detector_version})
                if "reward" in raw:
                    if not is_finite_reward(raw["reward"]):
                        raise DemoError("unsupported_export", "An exported reward was not a finite number.")
                    clean["reward"] = raw["reward"]
                for name, value in raw.get("provenance", {}).items():
                    if value is not None and name not in {"version", "created_at_start", "created_at_end", "record_ids"}:
                        metadata_review.append({"example_index": index, "field": "provenance." + name,
                                                "action": "omitted", "before": value, "after": None})
                transformed.append(clean)
                response["examples"].append({"id": f"example-{index + 1}", "raw": raw, "clean": clean, "changes": changes})
                summary["messages"] += len(raw["messages"])
                if changes:
                    summary["examples_changed"] += 1
                # Deliberate test seam runs after real Core processing, before publication.
                if inject_failure:
                    raise DemoError("injected_failure", "The test processing error stopped this run. No release was published.")
            if inject_failure:
                raise DemoError("injected_failure", "The test processing error stopped this run. No release was published.")
            # Exact schema validation and a second Core pass catch adapter omissions.
            # This is a pipeline check, not independent proof of real-world PII recall.
            for raw, clean in zip(raw_examples, transformed, strict=True):
                if [x["role"] for x in raw["messages"]] != [x["role"] for x in clean["messages"]]:
                    raise DemoError("validation_failed", "Message roles changed during processing.")
                for message in clean["messages"]:
                    if scan_and_transform(message["content"], config).text != message["content"]:
                        raise DemoError("validation_failed", "The cleaned content failed the release check.")
            summary.update({"examples": len(transformed), "replacements": sum(by_entity.values()), "by_entity": dict(sorted(by_entity.items()))})
            metadata_review.extend([
                {"field": "manifest.context_uri", "action": "omitted", "before": manifest.get("context_uri"), "after": None},
                {"field": "manifest.source_record_ids", "action": "omitted", "before": f"{len(manifest.get('source_record_ids', []))} source IDs", "after": None},
                {"field": "statistics.by_tenant / by_source", "action": "not_released", "before": "Raw labels remain private", "after": "Aggregate counts only"},
            ])
            training_bytes = ("\n".join(canonical(item) for item in transformed) + "\n").encode("utf-8")
            (clean_dir / "training.jsonl").write_bytes(training_bytes)
            summary["duration_ms"] = round((time.perf_counter() - started) * 1000, 2)
            receipt = {
                "schema": "datafog.training-release.v1", "status": "ready", "release_id": run_id,
                "source": {"reference": dataset.dataset_id, "version": dataset.source_version, "content_sha256": dataset.content_hash},
                "format": "sft.messages.v1", "versions": versions(), "policy": policy, "policy_hash": policy_hash,
                "counts": {k: summary[k] for k in ("examples", "messages", "replacements", "examples_changed", "by_entity")},
                "files": [{"path": "training.jsonl", "sha256": digest(training_bytes), "bytes": len(training_bytes)}],
                "checks": {"schema_valid": True, "message_order_and_roles_preserved": True,
                           "raw_lineage_omitted": True, "core_idempotence_passed": True},
                "coverage": {"types": policy["entities"], "scope": "Approved message content; raw provenance and sidecars omitted",
                             "limits": ["Arbitrary names in prose, faces, voices and general secrets are not detected.",
                                        "Synthetic fixture coverage is not a real-world accuracy measurement."]},
                "duration_ms": summary["duration_ms"],
            }
            (clean_dir / "receipt.json").write_text(json.dumps(receipt, ensure_ascii=False, indent=2, allow_nan=False) + "\n")
            with zipfile.ZipFile(clean_dir / "release.zip", "w", compression=zipfile.ZIP_DEFLATED) as archive:
                archive.write(clean_dir / "training.jsonl", "training.jsonl")
                archive.write(clean_dir / "receipt.json", "receipt.json")
            # Rename on the same local filesystem: no partially built bundle is downloadable.
            clean_dir.rename(release_dir)
            response.update({"status": "ready", "metadata_review": metadata_review, "receipt": receipt,
                             "download_url": f"/api/runs/{run_id}/bundle"})
            if len(canonical(response).encode("utf-8")) > MAX_RETAINED_BYTES:
                raise DemoError("review_too_large", "This file creates more review detail than the public demo can retain. Try a smaller synthetic file.")
            with self.lock:
                self.runs[run_id] = Run(response, release_dir)
            self.prune()
            return response
        except Exception as error:
            safe = error if isinstance(error, DemoError) else DemoError("processing_failed", "Processing stopped before release. Retry the sample or adjust the policy.", 500)
            response.update({"status": "blocked", "error": {"code": safe.code, "message": safe.message}, "receipt": None, "download_url": None})
            # A blocked response does not expose partially cleaned examples as a usable result.
            response["examples"] = []
            response["metadata_review"] = []
            summary["duration_ms"] = round((time.perf_counter() - started) * 1000, 2)
            if release_dir.exists():
                shutil.rmtree(release_dir)
            with self.lock:
                self.runs[run_id] = Run(response)
            self.prune()
            return response
        finally:
            shutil.rmtree(staging, ignore_errors=True)

    def release_file(self, run_id: str, name: str) -> Path:
        self.prune()
        with self.lock:
            run = self.runs.get(run_id)
        if run is None:
            raise DemoError("session_expired", "This temporary release is no longer available. Run the export again.", 404)
        if run.response["status"] != "ready" or run.release_dir is None:
            raise DemoError("release_blocked", "This run did not publish a release.", 409)
        run.last_used = time.monotonic()
        path = run.release_dir / name
        if not path.is_file():
            raise DemoError("session_expired", "This temporary file is no longer available. Run the export again.", 404)
        return path

