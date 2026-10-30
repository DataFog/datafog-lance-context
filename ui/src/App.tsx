import { useEffect, useRef, useState } from "react";
import implementation from "../../src/datafog_lance_context/geneva_enrichment.py?raw";
import savedRun from "../../cloudflare/geneva-verification.json?raw";

type Row = {
  asset_id: string;
  chunk_index: number;
  source_uri: string;
  split: string;
  has_pii: boolean;
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
  selected_keys: string[];
  duration_ms: number;
  versions: { lancedb: string; datafog_core: string; geneva: string };
  udf: string;
  execution: string;
  job_id: string;
  job_status: string;
  table_name: string;
  pipeline: string;
  output_schema: string;
  input_rows: number;
};
const udf = implementation.slice(implementation.indexOf("class TrainingRow"), implementation.indexOf("\n\ndef ingest_training_data"));
const pipeline = implementation.slice(implementation.indexOf("def ingest_training_data"), implementation.indexOf("\n\ndef run_geneva_enrichment"));
const savedResult: Result = JSON.parse(savedRun);
const query = `table.search() \\\n    .where("has_pii = false") \\\n    .to_arrow()`;
export default function App() {
  const [result, setResult] = useState<Result | null>(savedResult),
    [resultSource, setResultSource] = useState<"saved" | "live">("saved"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [filtered, setFiltered] = useState(false);
  const terminal = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (terminal.current) terminal.current.scrollTop = busy || error ? 0 : terminal.current.scrollHeight;
  }, [result, filtered, error, busy]);
  async function run() {
    setBusy(true);
    setError("");
    setFiltered(false);
    const runId = crypto.randomUUID();
    try {
      // A sleeping runtime can briefly return a proxy/startup error as it wakes.
      for (let attempt = 0; attempt < 3; attempt++) {
        const response = await fetch("/api/enrichment", { method: "POST", headers: {"Idempotency-Key": runId} });
        const body = await response.json().catch(() => null);
        if (response.ok) { setResult(body); setResultSource("live"); break; }
        const starting = response.status === 503 || (response.status === 500 && !body);
        if (starting && attempt < 2) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }
        throw Error(body?.error?.message || "Ingestion failed. Retry the run.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Run failed. Retry.");
    } finally {
      setBusy(false);
    }
  }
  const rows =
    result?.rows.filter(
      (row) => !filtered || result.selected_keys.includes(`${row.asset_id}:${row.chunk_index}`),
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
          <span>MLE’s UDF + DataFog</span>
          <i>→</i>
          <span className={result ? "done" : ""}>LanceDB table</span>
          <i>→</i>
          <span>Training selection</span>
        </div>
      </div>
      <main className="workspace">
        <section className="configuration" aria-label="UDF and table schema">
          <details className="code-step">
          <summary className="panel-heading">
            <span>01 / INGESTION UDF</span>
            <span className="expand-icon" aria-hidden="true">+</span>
          </summary>
          <pre className="code"><code>{`from typing import Iterator, NamedTuple, Optional\nfrom geneva import chunker\nfrom datafog_core import scan\n\n${result?.udf || udf}`}</code></pre>
          </details>
          <div className="panel-heading flow-step">
            <span>02 / OUTPUT SCHEMA</span>
            <span>↓</span>
          </div>
          <pre className="code schema-code"><code>{result?.output_schema || "chunk_index: int64\ntext: string\nhas_pii: bool\npii_types: list<string>"}</code></pre>
          <details className="code-step">
          <summary className="panel-heading flow-step">
            <span>03 / WRITE TO LANCEDB</span>
            <span className="expand-icon" aria-hidden="true">+</span>
          </summary>
          <pre className="code pipeline-code"><code>{result?.pipeline || pipeline}</code></pre>
          </details>
          <div className="table-heading">
            <span>04 / INGESTED ROWS</span>
            <code>training_data {result ? `· v${result.version}` : ""}</code>
          </div>
          {!result ? (
            <div className="table-placeholder">
              <div>
                asset_id <span>source_uri</span> split
              </div>
              <p>Run the ingestion UDF.</p>
            </div>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>asset_id</th>
                    <th>has_pii</th>
                    <th>pii_types</th>
                    <th>source_uri</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={`${row.asset_id}:${row.chunk_index}`}>
                      <td>{row.asset_id}</td>
                      <td>
                        <span className={row.has_pii ? "flag yes" : "flag no"}>
                          {String(row.has_pii)}
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
                      <td>{row.source_uri}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="next-step">
            <div>
              <span>05 / USE THE METADATA</span>
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
            <span>cloudflare / geneva</span>
            <span>{busy ? "RUNNING LIVE" : resultSource === "saved" ? "SAVED RESULT" : "LIVE RESULT"}</span>
          </div>
          <div ref={terminal} className="terminal-body" role="log" aria-live="polite">
            <p className="command">
              $ uv run python examples/ingest_training_rows.py
            </p>
            {!result && !busy && !error && (
              <p className="muted">Self-hosted Geneva · R2 table</p>
            )}
            {busy && (
              <p className="pending">
                Running the MLE’s ingestion UDF…
              </p>
            )}
            {error && (
              <p className="terminal-error" role="alert">
                {error}
              </p>
            )}
            {result && (
              <>
                {(busy || error) && <p className="muted">Previous successful run</p>}
                <p className="muted">
                  geneva {result.versions.geneva} · lancedb {result.versions.lancedb} · datafog-core{" "}
                  {result.versions.datafog_core}
                </p>
                <p>{result.execution}</p>
                <p>Received {result.input_rows} new documents</p>
                <p>Running prepare_training_rows · training-ingestion-v2</p>
                <pre>{result.output_schema}</pre>
                <p className="success">DataFog scan runs before each row is emitted</p>

                <p>Writing {result.table_name}</p>
                <p>Ingestion job: {result.job_id}</p>
                <p className="success">{result.job_status} · {result.rows.length} rows inserted</p>
                <p>Committed training rows · version {result.version}</p>
                <pre>{[
                  "row_id      has_pii  pii_types",
                  ...result.rows.map(row => `${`${row.asset_id}:${row.chunk_index}`.padEnd(12)}${String(row.has_pii).padEnd(9)}${JSON.stringify(row.pii_types)}`),
                ].join("\n")}</pre>
                <hr />
                <p>
                  {result.flagged} rows flagged ·{" "}
                  {result.rows.length - result.flagged} rows with no selected
                  PII patterns detected
                </p>
                <p className="muted">{resultSource === "saved" ? "Recorded run" : "Completed in"} {result.duration_ms} ms</p>
                {filtered && (
                  <>
                    <p className="command">&gt; WHERE has_pii = false</p>
                    <p>{result.selected_keys.join("\n")}</p>
                    <p className="success">
                      {result.selected_keys.length} rows selected
                    </p>
                  </>
                )}
              </>
            )}
          </div>
          <div className="runbar">
            <button
              className="secondary live-action"
              disabled={busy}
              onClick={() => void run()}
            >
              {busy ? "Ingesting…" : "Run live ingestion"}
              <span>↵</span>
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
