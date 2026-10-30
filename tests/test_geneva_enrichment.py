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
