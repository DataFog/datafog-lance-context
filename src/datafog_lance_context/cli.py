"""Run the same pipeline locally without the review UI."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import shutil
import sys
import tempfile

from .pipeline import DEFAULT_ENTITIES, DemoError, DemoStore


def main() -> None:
    parser = argparse.ArgumentParser(description="Export a synthetic chat dataset through real Lance and DataFog Core")
    parser.add_argument("input", type=Path, help="Conversation JSONL")
    parser.add_argument("--output", type=Path, required=True, help="New release directory")
    parser.add_argument("--entities", nargs="+", default=DEFAULT_ENTITIES)
    parser.add_argument("--redact-support-email", action="store_true")
    parser.add_argument("--test-blocked-release", action="store_true")
    args = parser.parse_args()
    if args.output.exists():
        parser.error("Output already exists; choose a new release directory.")
    store = DemoStore()
    staged_output: Path | None = None
    try:
        data = store.import_dataset(args.input.read_text(), args.input.name)
        result = store.run_export(data["dataset_id"], {"entities": args.entities, "allow_support_email": not args.redact_support_email}, args.test_blocked_release)
        if result["status"] != "ready":
            print(json.dumps({"status": "blocked", "error": result["error"]}), file=sys.stderr)
            raise SystemExit(1)
        source = store.release_file(result["run_id"], "receipt.json").parent
        args.output.parent.mkdir(parents=True, exist_ok=True)
        staged_output = Path(tempfile.mkdtemp(prefix=".datafog-release-", dir=args.output.parent))
        shutil.copytree(source, staged_output, dirs_exist_ok=True)
        staged_output.rename(args.output)
        staged_output = None
        print(json.dumps({"status": "ready", "output": str(args.output), "summary": result["summary"]}, indent=2))
    except DemoError as error:
        print(json.dumps({"status": "blocked", "error": {"code": error.code, "message": error.message}}), file=sys.stderr)
        raise SystemExit(1) from None
    except (OSError, UnicodeError):
        print(json.dumps({"status": "blocked", "error": {"code": "file_error", "message": "The input could not be read or the completed output could not be saved."}}), file=sys.stderr)
        raise SystemExit(1) from None
    finally:
        if staged_output:
            shutil.rmtree(staged_output, ignore_errors=True)
        shutil.rmtree(store.root, ignore_errors=True)


if __name__ == "__main__":
    main()
