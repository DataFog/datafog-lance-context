from datafog_lance_context.enrichment import datafog_pii, run_enrichment


def test_udf_detects_patterns_without_transforming_source():
    text = 'Contact vendor@example.com at (202) 555-0102.'
    assert datafog_pii(text) == {'has_PII': True, 'pii_types': ['EMAIL', 'PHONE']}
    assert text == 'Contact vendor@example.com at (202) 555-0102.'
    assert datafog_pii('Inspect the component and record the outcome.') == {'has_PII': False, 'pii_types': []}


def test_native_table_schema_and_selection():
    result = run_enrichment()
    assert len(result['rows']) == 6
    assert result['flagged'] == 4
    assert result['source_version'] < result['version']
    assert 'has_PII' not in result['source_schema']
    assert 'has_PII: bool' in result['schema']
    assert 'pii_types: list<' in result['schema']
    assert result['selected_ids'] == ['doc_001', 'doc_005']
    assert next(row for row in result['rows'] if row['asset_id'] == 'doc_004')['pii_types'] == ['CREDIT_CARD']
    assert all(set(row) == {'asset_id', 'source_uri', 'split', 'has_PII', 'pii_types'} for row in result['rows'])
