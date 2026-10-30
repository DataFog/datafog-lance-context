import { useEffect, useRef, useState } from "react";
import implementation from "../../src/datafog_lance_context/enrichment.py?raw";

type Row = {
  asset_id: string;
  source_uri: string;
  split: string;
  has_PII: boolean;
  pii_types: string[];
};
type Result = {
  rows: Row[];
  source_schema: string;
  schema: string;
  source_version: number;
  version: number;
  flagged: number;
  selected_ids: string[];
  duration_ms: number;
  versions: { lancedb: string; datafog_core: string };
  udf: string;
  execution: string;
};
const udf = implementation.slice(
  implementation.indexOf("def datafog_pii("),
  implementation.indexOf("\n\ndef run_enrichment"),
);
const pipeline = `# Existing file ingestion\nrows = load_manifest("training-assets.jsonl")\ntable = db.open_table("training_data")\n\n# Add DataFog enrichment\nenriched = [\n    {**row, **datafog_pii(read_text(row["source_uri"]))}\n    for row in rows\n]\ntable.add_columns(pa.schema([\n    pa.field("has_PII", pa.bool_()),\n    pa.field("pii_types", pa.list_(pa.string())),\n]))\ntable.merge_insert("asset_id") \\\n    .when_matched_update_all().execute(enriched)`;
const query = `table.search() \\\n    .where("has_PII = false") \\\n    .to_arrow()`;
export default function App() {
  const [result, setResult] = useState<Result | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [tab, setTab] = useState("UDF"),
    [filtered, setFiltered] = useState(false);
  const terminal = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (terminal.current) terminal.current.scrollTop = terminal.current.scrollHeight;
  }, [result, filtered, error]);
  async function run() {
    setBusy(true);
    setError("");
    setFiltered(false);
    setResult(null);
    try {
      const response = await fetch("/api/enrichment", { method: "POST" });
      if (!response.ok)
        throw Error("The engine is unavailable. Retry the run.");
      setResult(await response.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Run failed. Retry.");
    } finally {
      setBusy(false);
    }
  }
  const rows =
    result?.rows.filter(
      (row) => !filtered || result.selected_ids.includes(row.asset_id),
    ) || [];
  return (
    <div className="workbench">
      <header className="brandbar">
        <a href="https://www.lancedb.com/" aria-label="LanceDB">
          <img
            alt="LanceDB"
            src="https://cdn.prod.website-files.com/69a866b324926425eccc4cf5/69ab0db86188576e86d098f7_c1b5a4653a6fa4cc4b2ff7641e1276b1_lanceDB_logo.avif"
          />
        </a>
        <span>× DataFog</span>
        <a
          className="source-link"
          href="https://github.com/DataFog/datafog-lance-context/tree/mobile-silent-flow"
        >
          Source ↗
        </a>
      </header>
      <div className="intro">
        <p className="eyebrow">TRAINING DATA / COLUMN ENRICHMENT</p>
        <h1>PII Enrichment for LanceDB</h1>
        <div className="flow">
          <span>Files</span>
          <i>→</i>
          <span>LanceDB table</span>
          <i>→</i>
          <span className={result ? "done" : ""}>DataFog UDF</span>
          <i>→</i>
          <span>Training selection</span>
        </div>
      </div>
      <main className="workspace">
        <section className="configuration" aria-label="UDF and table schema">
          <div className="panel-heading">
            <span>01 / DEFINE</span>
            <span>Python</span>
          </div>
          <nav className="tabs" aria-label="Code views">
            {["UDF", "Ingestion", "Schema"].map((name) => (
              <button
                key={name}
                aria-pressed={tab === name}
                onClick={() => setTab(name)}
              >
                {name}
              </button>
            ))}
          </nav>
          <pre className="code">
            <code>
              {tab === "UDF"
                ? `from datafog_core import scan\n\nENTITIES = ["EMAIL", "PHONE", "SSN", "CREDIT_CARD"]\n\n${result?.udf || udf}`
                : tab === "Ingestion"
                  ? pipeline
                  : result?.schema ||
                    "training_data\n  asset_id: string\n  source_uri: string\n  split: string\n\n+ has_PII: bool\n+ pii_types: list<string>"}
            </code>
          </pre>
          <div className="schema-delta">
            <span>NEW COLUMNS</span>
            <div>
              <code>has_PII</code>
              <small>bool</small>
            </div>
            <div>
              <code>pii_types</code>
              <small>list&lt;string&gt;</small>
            </div>
          </div>
          <div className="table-heading">
            <span>02 / MATERIALIZE</span>
            <code>training_data {result ? `· v${result.version}` : ""}</code>
          </div>
          {!result ? (
            <div className="table-placeholder">
              <div>
                asset_id <span>source_uri</span> split
              </div>
              <p>Run the UDF to populate the added columns.</p>
            </div>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>asset_id</th>
                    <th>source_uri</th>
                    <th>has_PII</th>
                    <th>pii_types</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.asset_id}>
                      <td>{row.asset_id}</td>
                      <td>{row.source_uri}</td>
                      <td>
                        <span className={row.has_PII ? "flag yes" : "flag no"}>
                          {String(row.has_PII)}
                        </span>
                      </td>
                      <td>
                        {row.pii_types.length
                          ? row.pii_types.map((type) => (
                              <span className="type" key={type}>
                                {type}
                              </span>
                            ))
                          : "[]"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="next-step">
            <div>
              <span>03 / USE THE METADATA</span>
              <h2>Select a training subset</h2>
            </div>
            <pre>
              <code>{query}</code>
            </pre>
            <button
              className="secondary"
              disabled={!result || busy}
              onClick={() => setFiltered((value) => !value)}
            >
              {filtered ? "Show all rows" : "Apply filter"}
            </button>
            {filtered && (
              <p role="status">
                {rows.length} of {result?.rows.length} rows match.
              </p>
            )}
          </div>
        </section>
        <section className="terminal-panel" aria-label="Execution terminal">
          <div className="terminal-header">
            <div className="dots">
              <b />
              <b />
              <b />
            </div>
            <span>local / enrichment.py</span>
            <span>{busy ? "RUNNING" : result ? "COMPLETE" : "READY"}</span>
          </div>
          <div ref={terminal} className="terminal-body" role="log" aria-live="polite">
            <p className="command">
              $ uv run python examples/enrich_training_table.py
            </p>
            {!result && !busy && !error && (
              <p className="muted">Local LanceDB · bundled fixture files</p>
            )}
            {busy && (
              <p className="pending">
                Executing file ingestion and PII enrichment…
              </p>
            )}
            {error && (
              <p className="terminal-error" role="alert">
                {error}
              </p>
            )}
            {result && (
              <>
                <p className="muted">
                  lancedb {result.versions.lancedb} · datafog-core{" "}
                  {result.versions.datafog_core}
                </p>
                <p>Read {result.rows.length} source files</p>
                <p>Created training_data · version {result.source_version}</p>
                <pre>{result.source_schema}</pre>
                <p className="success">+ has_PII: bool</p>
                <p className="success">+ pii_types: list&lt;string&gt;</p>
                <p>Applied datafog_pii(text) to {result.rows.length} rows</p>
                <p>Committed enrichment · version {result.version}</p>
                <hr />
                <p>
                  {result.flagged} rows flagged ·{" "}
                  {result.rows.length - result.flagged} rows with no selected
                  PII patterns detected
                </p>
                <p className="muted">Completed in {result.duration_ms} ms</p>
                {filtered && (
                  <>
                    <p className="command">&gt; WHERE has_PII = false</p>
                    <p>{result.selected_ids.join("\n")}</p>
                    <p className="success">
                      {result.selected_ids.length} rows selected
                    </p>
                  </>
                )}
              </>
            )}
          </div>
          <div className="runbar">
            <button
              className="primary"
              disabled={busy}
              onClick={() => void run()}
            >
              {busy ? "Running UDF…" : result ? "Run again" : "Run enrichment"}
              <span>↵</span>
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
