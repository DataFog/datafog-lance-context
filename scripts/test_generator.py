"""Verify replay and immutable fixture behavior using the saved real AI response."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

REPOSITORY = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('generate_dataset', REPOSITORY / 'scripts/generate_dataset.py')
generator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(generator)


class GeneratorReplayTests(unittest.TestCase):
    def test_replay_creates_new_version_and_preserves_old_published_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'data').mkdir()
            (root / 'data/support-conversations-v1.jsonl').write_bytes(b'immutable v1\n')
            args = ['generate_dataset.py', '--version', 'v2', '--response-file', str(REPOSITORY / 'data/generation-response-v1.json')]
            with patch.object(generator, 'ROOT', root), patch('sys.argv', args), contextlib.redirect_stdout(io.StringIO()):
                generator.main()
            self.assertEqual((root / 'data/support-conversations-v1.jsonl').read_bytes(), b'immutable v1\n')
            generated = (root / 'data/support-conversations-v2.jsonl').read_bytes()
            self.assertEqual(generated, (REPOSITORY / 'data/support-conversations-v1.jsonl').read_bytes())
            self.assertEqual(generated, (root / 'ui/public/samples/support-conversations-v2.jsonl').read_bytes())
            provenance = json.loads((root / 'data/generation-provenance-v2.json').read_text())
            self.assertEqual(provenance['fixture_version'], 'v2')
            self.assertEqual(provenance['model'], '@cf/meta/llama-3.3-70b-instruct-fp8-fast')

    def test_existing_version_is_rejected_before_generation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'data').mkdir()
            (root / 'data/support-conversations-v1.jsonl').write_bytes(b'keep this\n')
            with patch.object(generator, 'ROOT', root), patch('sys.argv', ['generate_dataset.py']), self.assertRaises(SystemExit):
                generator.main()
            self.assertEqual((root / 'data/support-conversations-v1.jsonl').read_bytes(), b'keep this\n')


if __name__ == '__main__':
    unittest.main()
