"""Run the same local UDF workflow as the web demo: uv run python examples/enrich_training_table.py."""
import json
from datafog_lance_context.enrichment import run_enrichment

if __name__ == '__main__':
    print(json.dumps(run_enrichment(), indent=2))
