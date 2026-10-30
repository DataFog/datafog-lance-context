import { useEffect, useRef, useState } from "react";
import implementation from "../../src/datafog_lance_context/geneva_enrichment.py?raw";

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
  versions: { lancedb: string; datafog_core: string; geneva: string };
  udf: string;
  execution: string;
  job_id: string;
  job_status: string;
  table_name: string;
  pipeline: string;
};
const udf = implementation.slice(implementation.indexOf("class PIIColumns"), implementation.indexOf("\n\ndef register_and_backfill"));
const pipeline = implementation.slice(implementation.indexOf("def register_and_backfill"), implementation.indexOf("\n\ndef run_geneva_enrichment"));
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
    const runId = crypto.randomUUID();
    try {
      // A sleeping runtime can briefly return a proxy/startup error as it wakes.
      for (let attempt = 0; attempt < 3; attempt++) {
        const response = await fetch("/api/enrichment", { method: "POST", headers: {"Idempotency-Key": runId} });
        const body = await response.json().catch(() => null);
        if (response.ok) { setResult(body); break; }
        const starting = response.status === 503 || (response.status === 500 && !body);
        if (starting && attempt < 2) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }
        throw Error(body?.error?.message || "Backfill failed. Retry the run.");
      }
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
            {["UDF", "Register & backfill", "Schema"].map((name) => (
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
                ? `from typing import NamedTuple, Optional\nfrom geneva import Columns, udf\nfrom datafog_core import scan\n\n${result?.udf || udf}`
                : tab === "Register & backfill"
                  ? `# Existing extracted-text table in R2\n# db = geneva.connect("s3://…")\ntable = db.open_table("training_data")\n\n${result?.pipeline || pipeline}`
                  : result?.schema ||
                    "training_data\n  asset_id: string\n  source_uri: string\n  split: string\n  text: string\n\n+ has_PII: bool\n+ pii_types: list<string>"}
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
              <p>Backfill the added columns.</p>
            </div>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>asset_id</th>
                    <th>has_PII</th>
                    <th>pii_types</th>
                    <th>source_uri</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.asset_id}>
                      <td>{row.asset_id}</td>
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
                      <td>{row.source_uri}</td>
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
            <span>cloudflare / geneva</span>
            <span>{busy ? "RUNNING" : result ? "COMPLETE" : "READY"}</span>
          </div>
          <div ref={terminal} className="terminal-body" role="log" aria-live="polite">
            <p className="command">
              $ uv run python examples/backfill_training_table.py
            </p>
            {!result && !busy && !error && (
              <p className="muted">Self-hosted Geneva · R2 table</p>
            )}
            {busy && (
              <p className="pending">
                Registering columns and running Geneva backfill…
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
                  geneva {result.versions.geneva} · lancedb {result.versions.lancedb} · datafog-core{" "}
                  {result.versions.datafog_core}
                </p>
                <p>{result.execution}</p>
                <p>Opened {result.table_name} · v{result.source_version}</p>
                <pre>{result.source_schema}</pre>
                <p className="success">+ has_PII: bool</p>
                <p className="success">+ pii_types: list&lt;string&gt;</p>
                <p>Registered detect_pii · datafog-core-0.5.0b3</p>
                <p>Backfill job: {result.job_id}</p>
                <p className="success">{result.job_status} · {result.rows.length} rows materialized</p>
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
              {busy ? "Backfilling…" : result ? "Run again" : "Run backfill"}
              <span>↵</span>
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
