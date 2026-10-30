"""A local ingestion UDF applied to a real, temporary LanceDB training table."""
from pathlib import Path
from tempfile import TemporaryDirectory
import inspect
import time
from threading import Lock
import importlib.metadata

import lancedb
import pyarrow as pa
from datafog_core import scan

RUN_LOCK = Lock()

ENTITIES = ['EMAIL', 'PHONE', 'SSN', 'CREDIT_CARD']
FIXTURES = [
    ('doc_001', 'manuals/product-guide.txt', 'Product installation requires a level surface and a grounded outlet.'),
    ('doc_002', 'forms/vendor-contact.txt', 'Contact vendor-02@example.com or (202) 555-0102 for delivery.'),
    ('doc_003', 'forms/onboarding.txt', 'Employee identifier on the form: 123-45-6789.'),
    ('doc_004', 'receipts/payment-04.txt', 'Payment card captured by OCR: 4111 1111 1111 1111.'),
    ('doc_005', 'procedures/quality-check.txt', 'Inspect each component and record the test outcome.'),
    ('doc_006', 'notes/project-review.txt', 'Send the project review to reviewer-06@example.com.'),
]


def datafog_pii(text: str) -> dict:
    findings = scan(text, {'entities': ENTITIES})
    return {
        'has_PII': bool(findings),
        'pii_types': sorted({finding.entity_type for finding in findings}),
    }


def run_enrichment() -> dict:
    started = time.perf_counter()
    with TemporaryDirectory(prefix='datafog-udf-') as temporary:
        root = Path(temporary)
        rows = []
        for asset_id, source_uri, text in FIXTURES:
            source = root / source_uri
            source.parent.mkdir(parents=True, exist_ok=True)
            source.write_text(text, encoding='utf-8')
            rows.append({'asset_id': asset_id, 'source_uri': source_uri, 'split': 'train'})
        database = lancedb.connect(str(root / 'lancedb'))
        table = database.create_table('training_data', rows)
        source_schema = str(table.schema)
        source_version = table.version
        enriched = [{**row, **datafog_pii((root / row['source_uri']).read_text(encoding='utf-8'))} for row in rows]
        table.add_columns(pa.schema([pa.field('has_PII', pa.bool_()), pa.field('pii_types', pa.list_(pa.string()))]))
        table.merge_insert('asset_id').when_matched_update_all().execute(enriched)
        result = table.to_arrow().sort_by('asset_id').to_pylist()
        selected = table.search().where('has_PII = false').limit(100).to_list()
        return {'rows': result, 'source_schema': source_schema, 'schema': str(table.schema),
                'source_version': source_version, 'version': table.version,
                'flagged': sum(row['has_PII'] for row in result),
                'selected_ids': sorted(row['asset_id'] for row in selected),
                'duration_ms': round((time.perf_counter() - started) * 1000),
                'versions': {'lancedb': importlib.metadata.version('lancedb'), 'datafog_core': importlib.metadata.version('datafog-core')},
                'udf': inspect.getsource(datafog_pii),
                'execution': 'Local LanceDB · bundled fixture files'}
