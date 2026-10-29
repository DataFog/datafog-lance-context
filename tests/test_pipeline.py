from __future__ import annotations

import hashlib
import io
import json
from pathlib import Path
import zipfile

import pytest
from fastapi.testclient import TestClient

from datafog_lance_context.api import create_app
from datafog_lance_context.pipeline import DemoError, DemoStore, DEFAULT_ENTITIES, validate_upload


def conversation(**overrides):
    value = {
        "schema_version": "1", "session_id": "session/customer@example.com",
        "tenant": "private-tenant@example.com", "source": "support-source@example.com",
        "external_id": "ticket/customer@example.com",
        "messages": [
            {"role": "user", "content": "🙂 Contact customer@example.com or (202) 555-0101 for order NS-100 on 2026-11-05."},
            {"role": "assistant", "content": "Please contact support@example.com. Your order NS-100 is scheduled for 2026-11-05."},
        ],
        "metadata": {"synthetic": True, "reward": 0.8},
    }
    value.update(overrides)
    return value


@pytest.fixture
def store(tmp_path):
    return DemoStore(tmp_path / "private")


def import_one(store, **overrides):
    return store.import_dataset(json.dumps(conversation(**overrides)))


def released_files(store, run):
    with zipfile.ZipFile(store.release_file(run["run_id"], "release.zip")) as archive:
        return {name: archive.read(name) for name in archive.namelist()}


def test_real_snapshot_export_transform_and_safe_bundle(store):
    dataset = import_one(store)
    run = store.run_export(dataset["dataset_id"])
    assert run["status"] == "ready"
    assert dataset["versions"]["lance_context"] == "0.6.5"
    assert dataset["versions"]["datafog_core"] == "0.3.1"
    assert run["summary"]["messages"] == 2
    assert run["summary"]["replacements"] == 2
    raw, clean = run["examples"][0]["raw"], run["examples"][0]["clean"]
    assert raw["provenance"]["version"] == dataset["source_version"]
    assert raw["provenance"]["session_id"] == "session/customer@example.com"
    assert clean["messages"][0]["content"].startswith("🙂 Contact [EMAIL] or [PHONE]")
    assert "support@example.com" in clean["messages"][1]["content"]
    assert "2026-11-05" in clean["messages"][0]["content"]
    assert "NS-100" in clean["messages"][0]["content"]
    assert [m["role"] for m in raw["messages"]] == [m["role"] for m in clean["messages"]]
    assert clean["reward"] == raw["reward"] == 0.8
    assert "provenance" not in clean
    assert run["summary"]["versions"] == dataset["versions"]
    files = released_files(store, run)
    assert set(files) == {"training.jsonl", "receipt.json"}
    # This exact-value oracle is independent of the detector's second-pass check.
    for content in files.values():
        assert b"customer@example.com" not in content
        assert b"private-tenant@example.com" not in content
        assert b"support-source@example.com" not in content
        assert b"(202) 555-0101" not in content
        assert str(store.root).encode() not in content
    receipt = json.loads(files["receipt.json"])
    assert hashlib.sha256(files["training.jsonl"]).hexdigest() == receipt["files"][0]["sha256"]
    assert receipt["source"]["content_sha256"] == hashlib.sha256(json.dumps(conversation()).encode()).hexdigest()
    assert not any(store.root.glob("*/run-*"))


def test_unicode_ranges_are_codepoints_and_policy_replay_is_stable(store):
    dataset = import_one(store)
    first = store.run_export(dataset["dataset_id"])
    second = store.run_export(dataset["dataset_id"])
    change = first["examples"][0]["changes"][0]
    raw = first["examples"][0]["raw"]["messages"][0]["content"]
    assert raw[change["start"]:change["end"]] == "customer@example.com"
    assert first["receipt"]["files"] == second["receipt"]["files"]
    assert first["summary"]["policy_hash"] == second["summary"]["policy_hash"]
    strict = store.run_export(dataset["dataset_id"], {"entities": DEFAULT_ENTITIES, "allow_support_email": False})
    assert strict["summary"]["replacements"] == first["summary"]["replacements"] + 1
    assert strict["summary"]["policy_hash"] != first["summary"]["policy_hash"]
    assert "support@example.com" not in store.release_file(strict["run_id"], "training.jsonl").read_text()


def test_injected_processing_error_leaves_no_published_release(store):
    dataset = import_one(store)
    run = store.run_export(dataset["dataset_id"], inject_failure=True)
    assert run["status"] == "blocked"
    assert run["error"]["code"] == "injected_failure"
    assert run["receipt"] is None and run["download_url"] is None
    assert not (store.root / ("release-" + run["run_id"])).exists()
    assert not any(store.root.glob("*/run-*"))
    with pytest.raises(DemoError, match="did not publish"):
        store.release_file(run["run_id"], "release.zip")
    assert store.run_export(dataset["dataset_id"])["status"] == "ready"


@pytest.mark.parametrize("row,code", [
    ([], "invalid_conversation"),
    (conversation(schema_version="9"), "unsupported_schema"),
    (conversation(messages=[{"role": [], "content": "raw-secret@example.com"}]), "invalid_message"),
    (conversation(messages=[{"role": "user", "content": None}]), "invalid_message"),
    (conversation(messages=[{"role": "user", "content": "\ud800"}]), "invalid_unicode"),
    (conversation(session_id="\ud800"), "invalid_unicode"),
    (conversation(metadata={"reward": "0.8"}), "invalid_reward"),
])
def test_validation_is_safe_and_precedes_lance_import(store, row, code):
    with pytest.raises(DemoError) as info:
        store.import_dataset(json.dumps(row))
    assert info.value.code == code
    assert "raw-secret" not in info.value.message
    assert not store.datasets


def test_invalid_json_duplicate_sessions_and_empty_policy(store):
    with pytest.raises(DemoError, match="Row 1"):
        validate_upload('{"messages": NaN}')
    with pytest.raises(DemoError) as info:
        store.import_dataset("\n".join([json.dumps(conversation())] * 2))
    assert info.value.code == "duplicate_session"
    dataset = import_one(store)
    with pytest.raises(DemoError) as info:
        store.run_export(dataset["dataset_id"], {"entities": []})
    assert info.value.code == "invalid_policy"


def test_api_health_downloads_blocking_and_expiry(store):
    with TestClient(create_app(store)) as client:
        health = client.get("/api/health").json()
        assert health["capabilities"]["real_lance_context"] is True
        assert health["versions"]["datafog_core"] == "0.3.1"
        invalid = client.post("/api/datasets", json={"content": {"secret": "raw-secret@example.com"}})
        assert invalid.status_code == 422
        assert "raw-secret" not in invalid.text
        dataset = client.post("/api/datasets", json={"content": json.dumps(conversation()), "filename": "../demo.jsonl"}).json()
        assert dataset["filename"] == "demo.jsonl"
        run = client.post("/api/runs", json={"dataset_id": dataset["dataset_id"]}).json()
        assert run["status"] == "ready"
        response = client.get(run["download_url"])
        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-store"
        assert zipfile.is_zipfile(io.BytesIO(response.content))
        blocked = client.post("/api/runs", json={"dataset_id": dataset["dataset_id"], "inject_failure": True}).json()
        assert client.get(f"/api/runs/{blocked['run_id']}/bundle").status_code == 409
        assert client.get("/api/runs/nonexistent/bundle").status_code == 404
        store.datasets[dataset["dataset_id"]].last_used = 0
        assert client.post("/api/runs", json={"dataset_id": dataset["dataset_id"]}).status_code == 404


def test_actual_workers_ai_fixture_with_independent_oracle(store):
    root = Path(__file__).resolve().parents[1]
    fixture = root / "data/support-conversations-v1.jsonl"
    oracle = json.loads((root / "data/ground-truth-v1.json").read_text())
    dataset = store.import_dataset(fixture.read_text(), fixture.name)
    run = store.run_export(dataset["dataset_id"])
    assert run["status"] == "ready"
    assert run["summary"]["examples"] == len(oracle["cases"])
    files = released_files(store, run)
    training = files["training.jsonl"].decode()
    all_released_text = "\n".join(content.decode() for content in files.values())
    raw_text = fixture.read_text()
    for case in oracle["cases"]:
        for known in case["message_values"]:
            selected = known["entity_type"] in DEFAULT_ENTITIES and not known["public_exception"]
            if selected:
                assert known["value"] not in all_released_text
            elif known["value"] in raw_text:
                assert known["value"] in training
        for canary in case["metadata_canaries"]:
            assert canary not in all_released_text
        for value in case["negative_values"]:
            if value in raw_text:
                assert value in training


@pytest.mark.parametrize("separator", ["\u2028", "\u2029"])
@pytest.mark.parametrize("ensure_ascii", [True, False])
def test_unicode_separators_are_text_not_jsonl_boundaries(store, separator, ensure_ascii):
    original = f"First{separator}second customer@example.com"
    row = conversation(messages=[{"role": "user", "content": original}])
    dataset = store.import_dataset(json.dumps(row, ensure_ascii=ensure_ascii) + "\n")
    run = store.run_export(dataset["dataset_id"])
    assert run["status"] == "ready"
    training = json.loads(store.release_file(run["run_id"], "training.jsonl").read_text())
    assert training["messages"][0]["content"] == f"First{separator}second [EMAIL]"
    assert run["examples"][0]["raw"]["messages"][0]["content"] == original


def test_out_of_range_reward_is_safe_validation_error(store):
    with TestClient(create_app(store)) as client:
        response = client.post("/api/datasets", json={
            "content": json.dumps(conversation(metadata={"reward": 10 ** 400})),
        })
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "invalid_reward"
        assert not store.datasets
