import pytest
import geneva
from datafog_lance_context.geneva_enrichment import prepare_training_rows


def test_ingestion_udf_emits_training_rows_with_pii_metadata():
    rows = list(prepare_training_rows.func(' Contact vendor@example.com \n\nInspect each component.'))
    assert [row.chunk_index for row in rows] == [0, 1]
    assert rows[0].text == 'Contact vendor@example.com'
    assert rows[0].has_pii is True
    assert rows[0].pii_types == ['EMAIL']
    assert rows[1].has_pii is False
    assert rows[1].pii_types == []
    assert list(prepare_training_rows.func('  \n\n ')) == []
    with pytest.raises(ValueError, match='Missing document text'):
        list(prepare_training_rows.func(None))


def test_ingestion_view_has_pii_in_output_schema_before_any_rows(tmp_path):
    import pyarrow as pa
    db = geneva.connect(tmp_path)
    source = db.create_table('documents', schema=pa.schema([('asset_id', pa.string()), ('raw_text', pa.string())]))
    training = db.create_udtf_view('training_data', source=source.search().select(['asset_id', 'raw_text']), udtf=prepare_training_rows)
    assert training.count_rows() == 0
    assert 'has_pii' in training.schema.names
    assert 'pii_types' in training.schema.names
    assert 'raw_text' not in training.schema.names
    assert 'has_pii' not in source.schema.names


def test_api_retry_reuses_completed_run_instead_of_backfilling_again(monkeypatch):
    from fastapi.testclient import TestClient
    from datafog_lance_context.api import create_app
    import datafog_lance_context.geneva_enrichment as implementation
    calls = []

    def run():
        calls.append(True)
        return {'job_id': str(len(calls)), 'job_status': 'DONE'}

    monkeypatch.setattr(implementation, 'run_geneva_enrichment', run)
    with TestClient(create_app()) as client:
        first = client.post('/api/enrichment', headers={'Idempotency-Key': 'run-one'})
        retry = client.post('/api/enrichment', headers={'Idempotency-Key': 'run-one'})
        next_run = client.post('/api/enrichment', headers={'Idempotency-Key': 'run-two'})
    assert first.status_code == retry.status_code == next_run.status_code == 200
    assert first.json() == retry.json()
    assert next_run.json()['job_id'] != first.json()['job_id']
    assert len(calls) == 2
