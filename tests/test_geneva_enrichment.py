import pytest
import geneva
from datafog_lance_context.geneva_enrichment import detect_pii


def test_real_udf_detection_and_missing_input():
    assert detect_pii.func('Contact vendor@example.com').has_PII is True
    assert detect_pii.func('Contact vendor@example.com').pii_types == ['EMAIL']
    assert detect_pii.func('Inspect each component.').has_PII is False
    assert detect_pii.func('Inspect each component.').pii_types == []
    with pytest.raises(ValueError, match='Missing extracted text'):
        detect_pii.func(None)


def test_real_geneva_registers_sibling_columns_without_marking_them_clean(tmp_path):
    table = geneva.connect(tmp_path).create_table('training_data', [{'text': 'vendor@example.com'}])
    table.add_columns(detect_pii)
    row = table.search().to_arrow().to_pylist()[0]
    assert row['has_PII'] is None
    assert row['pii_types'] is None
    assert table.schema.field('has_PII').metadata[b'virtual_column'] == b'true'


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
