#!/usr/bin/env python3
"""Exercise a deployed real engine, immutable sample and blocked-release boundary."""
from __future__ import annotations

import argparse
import hashlib
import io
import json
from pathlib import Path
import tomllib
import urllib.error
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def request(base, path, payload=None):
    headers = {'User-Agent': 'DataFogDemoVerifier/0.1', 'Accept': 'application/json'}
    body = None
    if payload is not None:
        body = json.dumps(payload, ensure_ascii=False).encode()
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(base + path, data=body, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=180) as response:
            return response.status, response.headers, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.headers, error.read()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', default='https://datafog-lance-context.sid-5af.workers.dev')
    args = parser.parse_args()
    base = args.base_url.rstrip('/')
    status, headers, sample = request(base, '/samples/support-conversations-v1.jsonl')
    assert status == 200, f'Public sample returned {status}'
    assert sample == (ROOT / 'data/support-conversations-v1.jsonl').read_bytes(), 'Public sample changed'
    assert 'application/x-ndjson' in headers.get('Content-Type', '')
    assert 'attachment' in headers.get('Content-Disposition', '')
    assert headers.get('Access-Control-Allow-Origin') == '*'
    status, _, health = request(base, '/api/health')
    assert status == 200, f'Engine is not ready: HTTP {status}; retry after container provisioning'
    health = json.loads(health)
    assert health['capabilities']['real_lance_context'] and health['capabilities']['real_datafog_core']
    dependencies = tomllib.loads((ROOT / 'pyproject.toml').read_text())['project']['dependencies']
    for package, field in [('datafog-core', 'datafog_core'), ('lance-context', 'lance_context')]:
        expected = next(item.split('==', 1)[1] for item in dependencies if item.startswith(package + '=='))
        assert health['versions'][field] == expected, f'Live {package} does not match the source pin; the previous image may still be running'
    status, _, dataset = request(base, '/api/datasets', {'content': sample.decode(), 'filename': 'support-conversations-v1.jsonl'})
    assert status == 200, f'Import returned {status}'
    dataset = json.loads(dataset)
    policy = {'entities': ['EMAIL', 'PHONE', 'SSN', 'CREDIT_CARD'], 'allow_support_email': True}
    status, _, run = request(base, '/api/runs', {'dataset_id': dataset['dataset_id'], 'policy': policy, 'inject_failure': False})
    assert status == 200
    run = json.loads(run)
    assert run['status'] == 'ready', run.get('error')
    status, _, bundle = request(base, run['download_url'])
    assert status == 200
    archive = zipfile.ZipFile(io.BytesIO(bundle))
    assert set(archive.namelist()) == {'training.jsonl', 'receipt.json'}
    training = archive.read('training.jsonl')
    receipt = json.loads(archive.read('receipt.json'))
    assert receipt['files'][0]['sha256'] == hashlib.sha256(training).hexdigest()
    released_text = '\n'.join(archive.read(name).decode() for name in archive.namelist())
    oracle = json.loads((ROOT / 'data/ground-truth-v1.json').read_text())
    checked = set()
    for case in oracle['cases']:
        for value in case['message_values']:
            if value['entity_type'] in policy['entities'] and not value['public_exception']:
                checked.add(value['value'])
        checked.update(case['metadata_canaries'])
    assert all(value not in released_text for value in checked), 'A seeded private value remains in the released files'
    assert 'support@example.com' in training.decode(), 'Allowed support address was removed'
    assert '2026-11-05' in training.decode(), 'Useful date was removed'
    for example in run['examples']:
        assert [message['role'] for message in example['raw']['messages']] == [message['role'] for message in example['clean']['messages']]
    status, _, blocked = request(base, '/api/runs', {'dataset_id': dataset['dataset_id'], 'policy': policy, 'inject_failure': True})
    assert status == 200
    blocked = json.loads(blocked)
    assert blocked['status'] == 'blocked' and blocked['download_url'] is None
    status, _, _ = request(base, '/api/runs/' + blocked['run_id'] + '/bundle')
    assert status == 409, 'A blocked release was downloadable'
    canary = 'SHOULD_NEVER_ECHO_PRIVATE_INPUT'
    status, _, error = request(base, '/api/datasets', {'content': canary, 'filename': 'invalid.jsonl'})
    assert status == 422 and canary not in error.decode()
    summary = {'base_url': base, 'sample_sha256': hashlib.sha256(sample).hexdigest(), 'real_versions': health['versions'], 'conversation_count': dataset['conversation_count'], 'message_count': dataset['message_count'], 'replacements': run['summary']['replacements'], 'examples_changed': run['summary']['examples_changed'], 'seeded_values_checked_absent': len(checked), 'training_hash_matches_receipt': True, 'allowed_values_preserved': True, 'blocked_download_rejected': True, 'invalid_upload_safe': True}
    print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    main()
