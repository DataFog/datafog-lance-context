"""Run the fixed synthetic example against GENEVA_DATABASE_URI."""
import json
from datafog_lance_context.geneva_enrichment import run_geneva_enrichment

print(json.dumps(run_geneva_enrichment(), indent=2))
