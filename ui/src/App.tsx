import { useState } from "react";
import savedRun from "../../cloudflare/geneva-verification.json?raw";

type Row = { asset_id: string; chunk_index: number; has_pii: boolean; pii_types: string[] };
type Result = { rows: Row[]; flagged: number; selected_keys: string[]; udf: string; pipeline: string; job_id: string; duration_ms: number; versions: {datafog_core: string; geneva: string; lancedb: string} };
const savedResult: Result = JSON.parse(savedRun);

function CodeExcerpt({source}: {source: string}) {
  const signature = source.split("\n").find(line => line.startsWith("def prepare_training_rows")) || "";
  const body = source.slice(source.indexOf("        findings = scan")).trimEnd();
  const lines = ["from datafog_core import scan", "", signature, "    # …prepare training chunks…", ...body.split("\n").map(line => line.slice(4))];
  return <pre className="excerpt"><code>{lines.map((line, index) => <span key={index} className={/has_pii=|pii_types=/.test(line) ? "added-line" : ""}>{line || " "}</span>)}</code></pre>;
}

export default function App() {
  const [result, setResult] = useState(savedResult);
  const [source, setSource] = useState<"saved" | "live">("saved");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [filtered, setFiltered] = useState(false);
  async function run() {
    setBusy(true); setError(""); setFiltered(false);
    const runId = crypto.randomUUID();
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const response = await fetch("/api/enrichment", {method: "POST", headers: {"Idempotency-Key": runId}});
        const body = await response.json().catch(() => null);
        if (response.ok) { setResult(body); setSource("live"); break; }
        if ((response.status === 503 || (response.status === 500 && !body)) && attempt < 2) {
          await new Promise(resolve => setTimeout(resolve, 2000)); continue;
        }
        throw Error(body?.error?.message || "Ingestion failed. Try again.");
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Ingestion failed. Try again."); }
    finally { setBusy(false); }
  }
  const rows = result.rows.filter(row => !filtered || result.selected_keys.includes(`${row.asset_id}:${row.chunk_index}`));
  return <div className="page">
    <header className="brandbar">
      <a href="https://www.lancedb.com/" aria-label="LanceDB"><img alt="LanceDB" src="https://cdn.prod.website-files.com/69a866b324926425eccc4cf5/69ab0db86188576e86d098f7_c1b5a4653a6fa4cc4b2ff7641e1276b1_lanceDB_logo.avif" /></a>
      <span>× DataFog</span>
    </header>
    <h1>PII Enrichment for LanceDB</h1>
    <main className="code-to-table">
      <section className="code-panel" aria-label="DataFog inside the ingestion UDF">
        <div className="panel-label">Inside your ingestion UDF <span aria-hidden="true">→</span></div>
        <CodeExcerpt source={result.udf}/>
      </section>
      <section className="result-panel" aria-label="Training table with PII metadata">
        <div className="table-title"><code>training_data</code><span className="provenance">{source === "saved" ? "Saved result" : "Live result"}</span></div>
        <div className="table-scroll"><table>
          <colgroup><col/><col className="new-column"/><col className="new-column"/></colgroup>
          <thead><tr><th>row_id</th><th>has_pii <span className="new-label">new</span></th><th>pii_types <span className="new-label">new</span></th></tr></thead>
          <tbody>{rows.map(row => <tr key={`${row.asset_id}:${row.chunk_index}`}><td>{row.asset_id}:{row.chunk_index}</td><td><span className={row.has_pii ? "flag detected" : "flag"}>{String(row.has_pii)}</span></td><td>{row.pii_types.length ? row.pii_types.map(type => <span className="pii-type" key={type}>{type}</span>) : <span className="empty">[]</span>}</td></tr>)}</tbody>
        </table></div>
        <div className="table-footer"><span>{filtered ? `${rows.length} of ${result.rows.length} rows` : `${result.rows.length} rows · ${result.flagged} flagged`}</span><button className="text-button" onClick={() => setFiltered(value => !value)}>{filtered ? "Show all rows" : "Select unflagged rows"}</button></div>
      </section>
    </main>
    <footer className="tools">
      <details className="implementation"><summary>Full implementation</summary>
        <div className="implementation-content"><pre><code>{`from typing import Iterator, NamedTuple, Optional\nfrom geneva import chunker\nfrom datafog_core import scan\n\n${result.udf}\n\n${result.pipeline}`}</code></pre>
          <p>Geneva {result.versions.geneva} · LanceDB {result.versions.lancedb} · DataFog Core {result.versions.datafog_core}</p>
          <p>Job {result.job_id} · {result.duration_ms} ms</p>
          <a href="https://github.com/DataFog/datafog-lance-context/tree/mobile-silent-flow">View source ↗</a>
        </div>
      </details>
      <button className="text-button live-action" disabled={busy} onClick={() => void run()}>{busy ? "Running live ingestion…" : "Run live ingestion"}</button>
      {busy && <p className="run-status" role="status">Showing the previous result while ingestion runs.</p>}
      {error && <p className="run-error" role="alert">{error}</p>}
    </footer>
  </div>;
}
