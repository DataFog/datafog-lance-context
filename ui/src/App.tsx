import { useEffect, useState } from "react";
import savedRun from "../../cloudflare/geneva-verification.json?raw";

type Row = { asset_id: string; chunk_index: number; split: string; has_pii: boolean; pii_types: string[] };
type Result = { rows: Row[]; flagged: number; selected_keys: string[]; table_name: string; version: number; job_id: string; udf: string; pipeline: string };
const savedResult: Result = JSON.parse(savedRun);
const titles = ["Today", "With DataFog", "Select rows for training"];
type Filter = "all" | "clean" | "flagged";

function Code({ text }: { text: string }) {
  return <pre><code>{text.split("\n").map((line, i) => <span key={i} className={/scan\(|has_pii|pii_types|from datafog/.test(line) ? "added-line" : ""}>{line || " "}</span>)}</code></pre>;
}

function TrainingTable({ result, enriched, populated = true }: { result: Result; enriched: boolean; populated?: boolean }) {
  return <div className="result-panel"><div className="table-title"><code>training_data</code></div><div className="table-scroll"><table>
    <colgroup><col/>{enriched && <><col className="new-column"/><col className="new-column"/></>}</colgroup>
    <thead><tr><th>row_id</th>{enriched && <><th>has_pii</th><th>pii_types</th></>}</tr></thead>
    <tbody>{populated ? result.rows.map(row => <tr key={`${row.asset_id}:${row.chunk_index}`}><td>{row.asset_id}:{row.chunk_index}</td>{enriched && <><td className={row.has_pii ? "detected" : ""}>{String(row.has_pii)}</td><td>{row.pii_types.length ? row.pii_types.map(type => <span className="pii-type" key={type}>{type}</span>) : <span className="empty">[]</span>}</td></>}</tr>) : <tr><td className="empty-table">0 rows</td></tr>}</tbody>
  </table></div><div className="table-footer">{populated ? result.rows.length : 0} rows</div></div>;
}

export default function App() {
  const [slide, setSlide] = useState(0);
  const [stage, setStage] = useState(0);
  const [replay, setReplay] = useState(0);
  const [filter, setFilter] = useState<Filter>("clean");
  const result = savedResult;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("button, a, input, textarea, select, summary")) return;
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault(); setSlide(value => Math.max(0, Math.min(2, value + (e.key === "ArrowRight" ? 1 : -1))));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => { window.scrollTo({top: 0, behavior: "instant"}); }, [slide]);
  useEffect(() => {
    setStage(0);
    if (slide === 2) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setStage(3); return; }
    const timers = [setTimeout(() => setStage(1), 400), setTimeout(() => setStage(2), 1200), setTimeout(() => setStage(3), 2100)];
    return () => timers.forEach(clearTimeout);
  }, [slide, replay]);
  function next() {
    if (slide === 2) { setFilter("clean"); setSlide(0); }
    else setSlide(value => value + 1);
  }
  const added = slide === 1 && stage >= 2;
  const code = [added ? "from datafog_core import scan\n" : "", "@chunker(version=\"training-ingestion-v2\", num_cpus=0.25)", "def prepare_training_rows(raw_text):", "    # …prepare training chunks…", ...(added ? ["    findings = scan(text, {\"entities\":", "        [\"EMAIL\", \"PHONE\", \"SSN\", \"CREDIT_CARD\"]})"] : []), "    yield TrainingRow(", "        chunk_index=chunk_index,", "        text=text,", ...(added ? ["        has_pii=bool(findings),", "        pii_types=sorted({", "            item.entity_type for item in findings", "        }),"] : []), "    )"].join("\n").trim();
  const selected = {...result, rows: result.rows.filter(row => filter === "all" || (filter === "clean" ? result.selected_keys.includes(`${row.asset_id}:${row.chunk_index}`) : row.has_pii))};
  function downloadManifest() {
    const manifest = {table_name: result.table_name, version: result.version, job_id: result.job_id, filter: filter === "all" ? null : `has_pii = ${filter === "clean" ? "false" : "true"}`, rows: selected.rows};
    const url = URL.createObjectURL(new Blob([JSON.stringify(manifest, null, 2)], {type: "application/json"}));
    const link = document.createElement("a");
    link.href = url; link.download = "training-batch-manifest.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  return <div className="page">
    <header className="brandbar"><a href="https://www.lancedb.com/" aria-label="LanceDB"><img alt="LanceDB" src="https://cdn.prod.website-files.com/69a866b324926425eccc4cf5/69ab0db86188576e86d098f7_c1b5a4653a6fa4cc4b2ff7641e1276b1_lanceDB_logo.avif"/></a><span>× DataFog</span></header>
    <h1>PII Enrichment for LanceDB</h1>
    <main><section className={`slide slide-${slide}`} key={slide} aria-labelledby="slide-title">
      <div className="slide-heading"><span className="step-number">0{slide + 1}</span><h2 id="slide-title">{titles[slide]}</h2></div>
      {slide < 2 && <>
        <div className={`workflow stage-${stage}`}>
          <div className="code-panel"><div className="panel-label">Ingestion UDF</div><Code text={code}/>
            <div className="schema-inline"><div className="panel-label">Output schema</div><Code text={`class TrainingRow(NamedTuple):\n    chunk_index: int\n    text: str${added ? "\n    has_pii: bool\n    pii_types: list[str]" : ""}`}/></div>
          </div>
          <div className="transfer" aria-hidden="true"><span>→</span><i/><i/><i/></div>
          <div className="workflow-table"><TrainingTable result={result} enriched={slide === 1 && stage === 3} populated={slide === 1 || stage === 3}/></div>
        </div>
        <div className="action-row"><button className="text-button" onClick={() => setReplay(value => value + 1)}>Replay animation</button></div>
      </>}
      {slide === 2 && <><div className="filters" role="group" aria-label="Filter training rows">{([["all", "All rows"], ["clean", "No PII detected"], ["flagged", "PII detected"]] as const).map(([value, label]) => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div><div className="query"><code>{`training.search()${filter === "all" ? "" : `.where(\"has_pii = ${filter === "clean" ? "false" : "true"}\")`}`}</code></div><TrainingTable result={selected} enriched/><div className="action-row"><button className="primary" onClick={downloadManifest}>Download batch manifest</button></div><div className="implementation-tools"><details><summary>Full implementation</summary><Code text={`from typing import Iterator, NamedTuple, Optional\nfrom geneva import chunker\nfrom datafog_core import scan\n\n${result.udf}\n\n${result.pipeline}`}/></details></div></>}
    </section></main>
    <nav className="slide-nav" aria-label="Slides"><button className="nav-button" disabled={slide === 0} onClick={() => setSlide(value => value - 1)} aria-label="Previous slide">←</button><div className="progress">{titles.map((title, i) => <button key={title} aria-label={`Slide ${i + 1}: ${title}`} aria-current={i === slide ? "step" : undefined} onClick={() => setSlide(i)}><span/></button>)}</div><button className="nav-button next" onClick={next}>{slide === 2 ? "Restart" : "Next"}<span aria-hidden="true">→</span></button></nav>
  </div>;
}
