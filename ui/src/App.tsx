import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';

type Stage = 'empty' | 'fetching' | 'importing' | 'imported' | 'running' | 'ready' | 'stale' | 'blocked' | 'expired' | 'error';
type Side = 'raw' | 'clean';
type Message = { role: string; content: string };
type Conversation = { session_id: string; tenant?: string; source?: string; external_id?: string; messages: Message[]; metadata?: Record<string, unknown> };
type Versions = { lance_context?: string; datafog_core?: string; [key: string]: unknown };
type Dataset = { dataset_id: string; source_version: number; conversation_count: number; message_count: number; conversations: Conversation[]; versions: Versions };
type Policy = { entities: string[]; allow_support_email: boolean };
type Change = { message_index: number; entity_type: string; start: number; end: number; output_start: number; output_end: number; replacement?: string };
type TrainingExample = { messages: Message[]; provenance?: { session_id?: string; [key: string]: unknown }; [key: string]: unknown };
type Example = { id: string; raw: TrainingExample; clean: TrainingExample; changes: Change[] };
type MetadataReview = { example_index?: number; field: string; action: string; before?: unknown; after?: unknown };
type Run = {
  run_id: string; status: 'ready' | 'blocked'; error?: { code: string; message: string };
  summary: { examples?: number; messages?: number; replacements?: number; examples_changed?: number; by_entity?: Record<string, number>; duration_ms?: number; source_version?: number; policy_hash?: string; versions?: Versions; [key: string]: unknown };
  examples: Example[]; metadata_review: MetadataReview[]; receipt: Record<string, unknown> | null; download_url: string | null;
};
type Notice = { message: string; type: 'error' | 'info' } | null;
type SavedInput = { content: string; filename: string; savedAt: string };
type SamplePreview = { content: string; conversations: number; messages: number };
type Mark = 'plain' | 'hit' | 'struck' | 'token';

const SAMPLE_PATH = '/samples/support-conversations-v1.jsonl';
const SAMPLE_NAME = 'support-conversations-v1.jsonl';
const PUBLIC_SAMPLE = `https://datafog-lance-context.sid-5af.workers.dev${SAMPLE_PATH}`;
const GENERATOR_SAMPLE = `https://datafog-lance-context-generator.sid-5af.workers.dev${SAMPLE_PATH}`;
const SOURCE_CACHE_KEY = 'datafog-lance-context:synthetic-source:v1';
const MAX_INPUT_BYTES = 2 * 1024 * 1024;
const STEPS = ['Source', 'Original', 'DataFog', 'Cleaned', 'Download'] as const;
const entityOptions = [
  { id: 'EMAIL', label: 'Email' }, { id: 'PHONE', label: 'Phone' }, { id: 'SSN', label: 'SSN' }, { id: 'CREDIT_CARD', label: 'Card' },
  { id: 'IP_ADDRESS', label: 'IP' }, { id: 'DATE', label: 'Date' }, { id: 'ZIP_CODE', label: 'ZIP' },
] as const;
const entityLabel = (id: string) => entityOptions.find(option => option.id === id)?.label.toUpperCase() || id.replaceAll('_', ' ');
const initialPolicy: Policy = { entities: ['EMAIL', 'PHONE', 'SSN', 'CREDIT_CARD'], allow_support_email: true };
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    upload: <><path d="M12 15V4m-5 5 5-5 5 5M5 20h14" /></>,
    download: <><path d="M12 4v11m-5-5 5 5 5-5M5 20h14" /></>,
    file: <><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" /><path d="M14 3v5h5" /></>,
    check: <path d="m5 12 5 5 9-10" />,
    code: <><path d="m8 7-5 5 5 5m8-10 5 5-5 5m-2-13-4 16" /></>,
    trash: <><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></>,
    replace: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6 7a7 7 0 0 1 11-2l3 3M4 16l3 3a7 7 0 0 0 11-2" /></>,
    alert: <><path d="m12 3 10 18H2zM12 9v5M12 17h.01" /></>,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    restart: <><path d="M4 12a8 8 0 1 0 2.4-5.7" /><path d="M4 4v4h4" /></>,
    sliders: <><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></>,
    back: <path d="m15 6-6 6 6 6" />,
    more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
  };
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">{paths[name] || paths.file}</svg>;
}

class ApiError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 0, code = 'request_failed') { super(message); this.status = status; this.code = code; }
}

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try { response = await fetch(path, options); }
  catch (error) { if (error instanceof DOMException && error.name === 'AbortError') throw error; throw new ApiError('Connection interrupted. Retry.', 0, 'network_error'); }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = body?.error?.message || (typeof body?.detail === 'string' ? body.detail : null);
    throw new ApiError(detail || (response.status === 404 ? 'Session expired. Reimport to continue.' : 'Request failed. Check the input and retry.'), response.status, body?.error?.code || 'request_failed');
  }
  return body as T;
}

/** Renders text with Core's real change ranges. `delay0` staggers each match so replacements play in reading order. */
function MarkedText({ text, changes, messageIndex, side, mark, delay0 }: { text: string; changes: Change[]; messageIndex: number; side: Side; mark: Mark; delay0: number }) {
  if (mark === 'plain') return <>{text}</>;
  const chars = Array.from(text);
  const ranges = changes.filter(c => c.message_index === messageIndex).map(c => ({
    start: side === 'raw' ? c.start : c.output_start, end: side === 'raw' ? c.end : c.output_end, type: c.entity_type,
  })).filter(r => Number.isInteger(r.start) && Number.isInteger(r.end) && r.start >= 0 && r.end > r.start && r.end <= chars.length).sort((a, b) => a.start - b.start);
  const parts: ReactNode[] = [];
  let cursor = 0;
  ranges.forEach((range, index) => {
    if (range.start < cursor) return;
    if (range.start > cursor) parts.push(chars.slice(cursor, range.start).join(''));
    const delay = `${Math.min(delay0 + index * 0.11, 2.6).toFixed(2)}s`;
    parts.push(<mark key={`${range.start}-${index}`} className={`pii pii-${mark}`} style={{ animationDelay: delay }} title={range.type.replaceAll('_', ' ')}>{chars.slice(range.start, range.end).join('')}</mark>);
    cursor = range.end;
  });
  if (cursor < chars.length) parts.push(chars.slice(cursor).join(''));
  return <>{parts}</>;
}

function Messages({ messages, side, changes, mark, delay0 }: { messages: Message[]; side: Side; changes: Change[]; mark: Mark; delay0: number }) {
  let offset = 0;
  return <div className={`messages side-${side}`}>
    {messages.map((message, index) => {
      const start = delay0 + offset * 0.11;
      offset += changes.filter(c => c.message_index === index).length;
      return <div className={`message role-${message.role}`} key={`${index}-${message.role}`}>
        <span className="role">{message.role}</span>
        <p><MarkedText text={message.content} changes={changes} messageIndex={index} side={side} mark={mark} delay0={start} /></p>
      </div>;
    })}
  </div>;
}

function useCountUp(target: number, active: boolean) {
  const [value, setValue] = useState(active ? 0 : target);
  useEffect(() => {
    if (!active || reducedMotion()) { setValue(target); return; }
    setValue(0);
    const started = performance.now();
    const duration = Math.min(400 + target * 45, 1400);
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min((now - started) / duration, 1);
      setValue(Math.round(target * (1 - Math.pow(1 - t, 3))));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, active]);
  return value;
}

function formatSaved(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function App() {
  const [stage, setStage] = useState<Stage>('empty');
  const [versions, setVersions] = useState<Versions | null>(null);
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [policy, setPolicy] = useState<Policy>(initialPolicy);
  const [notice, setNotice] = useState<Notice>(null);
  const [view, setView] = useState<Side>('raw');
  const [revealing, setRevealing] = useState(false);
  const [revealKey, setRevealKey] = useState(0);
  const [phase, setPhase] = useState<'review' | 'download'>('review');
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 899px)').matches);
  const [dragging, setDragging] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [failureTest, setFailureTest] = useState(false);
  const [filename, setFilename] = useState('');
  const [savedInput, setSavedInput] = useState<SavedInput | null>(null);
  const [sample, setSample] = useState<SamplePreview | null>(null);
  const [sampleLoading, setSampleLoading] = useState(true);
  const [sampleError, setSampleError] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const sampleController = useRef<AbortController | null>(null);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const revealTimer = useRef<number | undefined>(undefined);
  const input = useRef<{ content: string; filename: string } | null>(null);
  const runPolicy = useRef('');
  const busy = stage === 'fetching' || stage === 'importing' || stage === 'running';
  const locked = busy || downloading !== null;
  const validRelease = run?.status === 'ready' && stage === 'ready' && runPolicy.current === JSON.stringify(policy);
  const hasResult = !!run && (stage === 'ready' || stage === 'blocked');
  const step = !dataset ? 0 : stage === 'running' ? 2 : hasResult ? (phase === 'download' && validRelease ? 4 : 3) : 1;
  const replacements = run?.summary?.replacements ?? 0;
  const withheld = (run?.metadata_review || []).filter(item => item.action === 'omitted').length;
  const count = useCountUp(replacements, step === 3 && view === 'clean' && !revealing && run?.status === 'ready');
  const intentionalFailure = failureTest && run?.error?.code === 'injected_failure';
  const savedSample = savedInput?.filename === SAMPLE_NAME && savedInput.content === sample?.content;

  useEffect(() => {
    api<{ versions: Versions }>('/api/health').then(result => setVersions(result.versions)).catch(() => undefined);
    void preloadSample();
    try {
      const value = localStorage.getItem(SOURCE_CACHE_KEY);
      if (value) {
        const saved = JSON.parse(value) as Partial<SavedInput>;
        if (typeof saved.content === 'string' && typeof saved.filename === 'string' && typeof saved.savedAt === 'string' && new Blob([saved.content]).size <= MAX_INPUT_BYTES) setSavedInput(saved as SavedInput);
        else localStorage.removeItem(SOURCE_CACHE_KEY);
      }
    } catch { /* Storage can be unavailable in private or restricted browsers. */ }
    return () => { controller.current?.abort(); sampleController.current?.abort(); window.clearTimeout(revealTimer.current); };
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 899px)');
    const update = () => setCompact(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
  }, [step]);

  function cacheSource(content: string, name: string): boolean {
    if (new Blob([content]).size > MAX_INPUT_BYTES) return false;
    const saved: SavedInput = { content, filename: name, savedAt: new Date().toISOString() };
    try { localStorage.setItem(SOURCE_CACHE_KEY, JSON.stringify(saved)); setSavedInput(saved); return true; }
    catch { return false; }
  }

  function clearSourceCache(): boolean {
    setSavedInput(null);
    try { localStorage.removeItem(SOURCE_CACHE_KEY); return true; }
    catch { return false; }
  }

  function newRequest() {
    controller.current?.abort();
    controller.current = new AbortController();
    generation.current += 1;
    window.clearTimeout(revealTimer.current);
    return { id: generation.current, signal: controller.current.signal };
  }

  function handleFailure(error: unknown, id: number) {
    if (id !== generation.current || (error instanceof DOMException && error.name === 'AbortError')) return;
    const expired = error instanceof ApiError && error.status === 404;
    setStage(expired ? 'expired' : dataset || input.current ? 'error' : 'empty');
    setNotice({ type: 'error', message: error instanceof Error ? error.message : 'Interrupted. Retry.' });
  }

  function clearResult() {
    setRun(null); setPhase('review'); setView('raw'); setRevealing(false); setFailureTest(false);
  }

  async function importText(content: string, name: string, request?: { id: number; signal: AbortSignal }) {
    const current = request || newRequest();
    setStage('importing'); setNotice(null); clearResult(); setDataset(null);
    input.current = { content, filename: name }; setFilename(name);
    try {
      if (new Blob([content]).size > MAX_INPUT_BYTES) throw new ApiError('Choose a JSONL file of 2 MiB or less.');
      const result = await api<Dataset>('/api/datasets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content, filename: name }), signal: current.signal });
      if (current.id !== generation.current) return;
      setDataset(result); setStage('imported');
      if (!cacheSource(content, name)) setNotice({ type: 'info', message: 'Imported. Browser storage unavailable.' });
      if (result.versions) setVersions(result.versions);
    } catch (error) { input.current = null; handleFailure(error, current.id); }
  }

  async function fetchSampleText(url: string, signal: AbortSignal) {
    const parsed = new URL(url, window.location.origin);
    const sameSample = parsed.origin === window.location.origin && parsed.pathname === SAMPLE_PATH;
    if (!sameSample && parsed.href !== PUBLIC_SAMPLE && parsed.href !== GENERATOR_SAMPLE) throw new ApiError('Drop the sample link or a JSONL file.');
    let response = await fetch(parsed.href, { signal, credentials: 'omit' });
    if (!response.ok && sameSample) response = await fetch('/api/sample', { signal });
    if (!response.ok) throw new ApiError('Sample download failed. Retry.');
    return response.text();
  }

  async function preloadSample() {
    sampleController.current?.abort();
    const current = new AbortController();
    sampleController.current = current;
    setSampleLoading(true); setSampleError(false);
    try {
      const content = await fetchSampleText(SAMPLE_PATH, current.signal);
      const rows = content.split('\n').filter(line => line.trim()).map(line => JSON.parse(line) as Conversation);
      if (current.signal.aborted) return;
      setSample({ content, conversations: rows.length, messages: rows.reduce((total, row) => total + row.messages.length, 0) });
    } catch {
      if (!current.signal.aborted) setSampleError(true);
    } finally {
      if (!current.signal.aborted) setSampleLoading(false);
    }
  }

  async function loadSample(url = SAMPLE_PATH) {
    const request = newRequest();
    setStage('fetching'); setNotice(null);
    try {
      const content = await fetchSampleText(url, request.signal);
      if (request.id !== generation.current) return;
      await importText(content, SAMPLE_NAME, request);
    } catch (error) { handleFailure(error, request.id); }
  }

  function saveBlob(blob: Blob, name: string) {
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = objectUrl; anchor.download = name;
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }

  async function downloadSample() {
    if (locked) return;
    const request = newRequest(); setStage('fetching'); setNotice(null);
    try {
      const content = sample?.content ?? await fetchSampleText(SAMPLE_PATH, request.signal);
      if (request.id !== generation.current) return;
      const saved = cacheSource(content, SAMPLE_NAME);
      saveBlob(new Blob([content], { type: 'application/x-ndjson' }), SAMPLE_NAME);
      setStage('empty');
      setNotice({ type: 'info', message: saved ? 'Downloaded and saved here.' : 'Downloaded. Browser storage unavailable.' });
    } catch (error) { handleFailure(error, request.id); }
  }

  async function loadFile(file: File) {
    const request = newRequest();
    setStage('importing'); setNotice(null);
    try { if (file.size > MAX_INPUT_BYTES) throw new ApiError('Choose a JSONL file of 2 MiB or less.'); const content = await file.text(); if (request.id === generation.current) await importText(content, file.name, request); }
    catch (error) { handleFailure(error, request.id); }
    if (fileInput.current) fileInput.current.value = '';
  }

  async function onDrop(event: DragEvent) {
    event.preventDefault(); setDragging(false);
    if (locked) return;
    if (event.dataTransfer.files.length > 1) { setNotice({ type: 'error', message: 'Drop one JSONL file.' }); return; }
    if (event.dataTransfer.files.length) { await loadFile(event.dataTransfer.files[0]); return; }
    const raw = event.dataTransfer.getData('text/uri-list') || event.dataTransfer.getData('text/plain');
    const url = raw.split('\n').find(line => line.trim() && !line.startsWith('#'))?.trim();
    if (url) await loadSample(url);
    else setNotice({ type: 'error', message: 'Drop a JSONL file or the sample link.' });
  }

  const dropProps = {
    onDragOver: (event: DragEvent) => { event.preventDefault(); if (!locked) setDragging(true); },
    onDragLeave: (event: DragEvent) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); },
    onDrop: (event: DragEvent) => void onDrop(event),
  };

  function updatePolicy(next: Policy) {
    setPolicy(next); setNotice(null);
    if (run) { setStage('stale'); setPhase('review'); setView('raw'); }
  }

  function toggleEntity(entity: string) {
    updatePolicy({ ...policy, entities: policy.entities.includes(entity) ? policy.entities.filter(value => value !== entity) : [...policy.entities, entity] });
  }

  function playReveal(result: Run) {
    setRevealKey(key => key + 1);
    if (result.status !== 'ready' || reducedMotion()) { setView(result.status === 'ready' ? 'clean' : 'raw'); setRevealing(false); return; }
    // Replay the real ranges: originals light up first, then their replacements land.
    setView('raw'); setRevealing(true);
    const total = result.examples.reduce((sum, example) => sum + example.changes.length, 0);
    revealTimer.current = window.setTimeout(() => { setView('clean'); setRevealing(false); setRevealKey(key => key + 1); }, Math.min(900 + total * 60, 2200));
  }

  async function runExport(injectFailure = false) {
    if (!dataset || locked) return;
    const current = newRequest();
    const currentPolicy = JSON.stringify(policy);
    setStage('running'); setNotice(null); setRun(null); setPhase('review'); setView('raw'); setFailureTest(injectFailure);
    try {
      const result = await api<Run>('/api/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataset_id: dataset.dataset_id, policy, inject_failure: injectFailure }), signal: current.signal });
      if (current.id !== generation.current) return;
      runPolicy.current = currentPolicy;
      setRun(result); setStage(result.status);
      playReveal(result);
    } catch (error) { handleFailure(error, current.id); }
  }

  async function download(kind: 'bundle' | 'training' | 'receipt') {
    if (!validRelease || !run || downloading) return;
    setDownloading(kind); setNotice(null);
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(run.run_id)}/${kind}`);
      if (!response.ok) throw new ApiError(response.status === 404 ? 'Release expired. Reimport to rebuild it.' : 'Download failed. Retry.', response.status);
      const blob = await response.blob();
      saveBlob(blob, kind === 'bundle' ? 'datafog-training-release.zip' : kind === 'training' ? 'training.jsonl' : 'privacy-receipt.json');
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) setStage('expired');
      setNotice({ type: 'error', message: error instanceof Error ? error.message : 'Download failed. Retry.' });
    } finally { setDownloading(null); }
  }

  function startOver() {
    newRequest(); setDataset(null); clearResult(); setStage('empty'); setNotice(null); setFilename(''); input.current = null;
  }

  function clearSaved() {
    const cleared = clearSourceCache();
    startOver();
    if (!cleared) setNotice({ type: 'error', message: 'Browser storage could not be cleared.' });
  }

  function showSide(side: Side) {
    window.clearTimeout(revealTimer.current);
    setRevealing(false); setView(side); setRevealKey(key => key + 1);
  }

  const conversations = (dataset?.conversations || []).map((conversation, index) => {
    const example = run?.examples?.find(item => item.raw?.provenance?.session_id === conversation.session_id) || run?.examples?.[index];
    return { conversation, example, index };
  });
  let staggerOffset = 0;
  const showBoth = !compact && hasResult && run?.status === 'ready';
  const rawMark: Mark = !hasResult || run?.status !== 'ready' ? 'plain' : revealing || showBoth ? 'hit' : 'struck';

  let primary: { label: string; action: () => void; disabled?: boolean; icon?: string; spinner?: boolean };
  if (step === 0) primary = busy
    ? { label: stage === 'importing' ? 'Importing' : 'Loading file', action: () => undefined, disabled: true, spinner: true }
    : sampleError
    ? { label: 'Retry sample', action: () => void preloadSample(), disabled: locked }
    : { label: sampleLoading ? 'Loading sample' : 'View original', action: () => sample && void importText(sample.content, SAMPLE_NAME), disabled: locked || !sample, spinner: sampleLoading };
  else if (step === 1) primary = stage === 'expired'
    ? { label: 'Reimport', action: () => input.current && void importText(input.current.content, input.current.filename), disabled: locked || !input.current }
    : { label: stage === 'stale' ? 'Rerun DataFog' : 'Apply DataFog', action: () => void runExport(), disabled: locked || policy.entities.length === 0 };
  else if (step === 2) primary = { label: 'Cleaning', action: () => undefined, disabled: true, spinner: true };
  else if (step === 3) primary = run?.status === 'blocked'
    ? { label: 'Retry', action: () => void runExport(), disabled: locked }
    : { label: 'Export', action: () => setPhase('download'), disabled: revealing || !validRelease };
  else primary = { label: downloading === 'training' ? 'Downloading' : 'Download JSONL', action: () => void download('training'), disabled: !!downloading, icon: 'download', spinner: downloading === 'training' };

  return <div className={`app step-${step}`} onDragOver={event => event.preventDefault()} onDrop={event => event.preventDefault()}>
    <header className="topbar">
      <div className="topbar-inner">
        <a href="https://www.lancedb.com/" target="_blank" rel="noreferrer" className="brand" aria-label="LanceDB website"><img src="https://cdn.prod.website-files.com/69a866b324926425eccc4cf5/69ab0db86188576e86d098f7_c1b5a4653a6fa4cc4b2ff7641e1276b1_lanceDB_logo.avif" width="118" height="24" alt="LanceDB" /><span className="brand-x">× DataFog</span></a>
        <a href="https://github.com/DataFog/datafog-lance-context" target="_blank" rel="noreferrer" className="icon-button" aria-label="Source on GitHub"><Icon name="code" size={20} /></a>
      </div>
      <ol className="rail" aria-label="Progress">
        {STEPS.map((label, index) => <li key={label} className={index < step ? 'done' : index === step ? 'current' : ''} aria-current={index === step ? 'step' : undefined}><span className="bar" /><span className="rail-label">{label}</span></li>)}
      </ol>
    </header>

    <input ref={fileInput} type="file" accept=".jsonl,.ndjson,application/x-ndjson,text/plain" className="visually-hidden" aria-label="Choose a conversation JSONL file" onChange={event => { const file = event.target.files?.[0]; if (file) void loadFile(file); }} />

    <main className="stage" key={step === 4 ? 'download' : step === 0 ? 'upload' : 'review'}>
      {step === 0 && <section className="upload" {...dropProps}>
        <h1>Redacting PII<br /><span>in Training Data</span></h1>
        <div className={`sample-card ${dragging ? 'dragging' : ''}`} aria-label="Preloaded sample file" aria-busy={sampleLoading}>
          <div className="sample-heading">
            <span className="file-badge"><Icon name="file" size={26} /></span>
            <div><span className="sample-label">Sample file</span><h2>Support conversations</h2></div>
            <span className="file-type">JSONL</span>
          </div>
          <code className="sample-filename">{SAMPLE_NAME}</code>
          {sample && <dl className="sample-stats">
            <div><dt>conversations</dt><dd>{sample.conversations}</dd></div>
            <div><dt>messages</dt><dd>{sample.messages}</dd></div>
          </dl>}
          {sampleError && <p className="field-error" role="alert">Sample unavailable. Retry or upload another JSONL.</p>}
          {(sampleLoading || busy) && <p className="sample-status" role="status"><span className="spinner" />{stage === 'importing' ? `Importing ${filename || SAMPLE_NAME}` : 'Loading file'}</p>}
          <div className="sample-footer">
            <span className="sample-ready" role="status">{sample && !sampleLoading && !sampleError && !busy ? 'Ready to review' : ''}</span>
            <details className="file-options">
              <summary aria-label="File options" title="File options"><Icon name="more" size={20} /></summary>
              <div className="file-menu">
                <button disabled={locked} onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); void downloadSample(); }}><Icon name="download" size={18} />Save source file</button>
                {savedSample && <button disabled={locked} onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); clearSaved(); }}><Icon name="trash" size={18} />Clear saved copy</button>}
              </div>
            </details>
          </div>
        </div>
        {savedInput && !savedSample && <div className="source-list">
          <div className="source-row saved">
            <span className="source-copy"><strong>Saved file</strong><small>{savedInput.filename} · {formatSaved(savedInput.savedAt)}</small></span>
            <button className="pill-button" disabled={locked} onClick={() => void importText(savedInput.content, savedInput.filename)}>Use saved file</button>
            <button className="icon-button" aria-label="Clear saved copy" disabled={locked} onClick={clearSaved}><Icon name="trash" size={19} /></button>
          </div>
        </div>}
        <button type="button" className={`text-button upload-another ${dragging ? 'dragging' : ''}`} onClick={() => fileInput.current?.click()} disabled={locked}><Icon name="upload" size={18} />Upload another JSONL</button>
      </section>}

      {(step === 1 || step === 2 || step === 3) && dataset && <section className={`review ${dragging ? 'dragging' : ''}`} {...dropProps}>
        <div className="source-bar">
          <Icon name="file" size={18} />
          <span className="source-name">{filename || 'Source'}</span>
          <span className="source-meta">{dataset.conversation_count} · v{dataset.source_version}</span>
          <button className="icon-button" aria-label="Replace file" disabled={locked} onClick={() => fileInput.current?.click()}><Icon name="replace" size={18} /></button>
          <button className="icon-button" aria-label="Clear saved copy" disabled={locked} onClick={clearSaved}><Icon name="trash" size={18} /></button>
        </div>

        {step === 3 && run?.status === 'ready' && <div className="tally" aria-live="polite">
          <div className="tally-count"><strong>{view === 'clean' && !revealing ? count : replacements}</strong><span>removed</span></div>
          <div className="tally-pills">{Object.entries(run.summary.by_entity || {}).map(([type, n]) => <span key={type}>{entityLabel(type)} {n}</span>)}</div>
        </div>}
        {step === 3 && run?.status === 'blocked' && <div className="blocked" role="alert"><Icon name="alert" size={20} /><span>{intentionalFailure ? 'Test failure. Nothing released.' : run.error?.message || 'Blocked. Nothing released.'}</span></div>}

        <div className="controls">
          {!showBoth && <div className="segmented" role="group" aria-label="View">
            <button aria-pressed={view === 'raw'} onClick={() => showSide('raw')}>Original</button>
            <button aria-pressed={view === 'clean'} disabled={!hasResult || run?.status !== 'ready'} onClick={() => showSide('clean')}>Cleaned</button>
          </div>}
          {showBoth && <div className="column-heads" aria-hidden="true"><span>Original</span><span>Cleaned</span></div>}
          {(step === 1 || step === 3) && <details className="rules">
            <summary aria-label="Rules"><Icon name="sliders" size={18} /><span>{policy.entities.length}</span></summary>
            <fieldset disabled={locked}>
              <legend className="visually-hidden">Data types to remove</legend>
              <div className="chips">{entityOptions.map(option => <label key={option.id} className={policy.entities.includes(option.id) ? 'on' : ''}><input type="checkbox" checked={policy.entities.includes(option.id)} onChange={() => toggleEntity(option.id)} />{option.label}</label>)}</div>
              <label className="switch"><span>Keep <code>support@example.com</code></span><input type="checkbox" checked={policy.allow_support_email} onChange={() => updatePolicy({ ...policy, allow_support_email: !policy.allow_support_email })} /></label>
              <button type="button" className="text-button" onClick={() => void runExport(true)} disabled={locked || policy.entities.length === 0}>Test blocked run</button>
            </fieldset>
          </details>}
        </div>
        {step === 1 && policy.entities.length === 0 && <p className="field-error" role="status">Select at least one type.</p>}

        <div className={`conversations ${step === 2 ? 'scanning' : ''} ${showBoth ? 'both' : ''}`}>
          {step === 2 && <span className="scan" aria-hidden="true" />}
          {conversations.map(({ conversation, example, index }) => {
            const changes = example?.changes || [];
            const delay0 = Math.min(staggerOffset * 0.11, 2.2);
            staggerOffset += changes.length;
            const scenario = typeof conversation.metadata?.scenario === 'string' ? conversation.metadata.scenario.replaceAll('_', ' ') : `conversation ${index + 1}`;
            const raw = example?.raw?.messages || conversation.messages;
            const clean = example?.clean?.messages;
            return <article className="conversation" key={`${conversation.session_id}-${index}-${revealKey}`}>
              <header><span>{scenario}</span><span>{hasResult && run?.status === 'ready' ? (changes.length ? `${changes.length} removed` : 'clean') : `${index + 1} / ${dataset.conversation_count}`}</span></header>
              <div className="sides">
                {(showBoth || view === 'raw' || !clean) && <Messages messages={raw} side="raw" changes={changes} mark={rawMark} delay0={delay0} />}
                {clean && (showBoth || view === 'clean') && <Messages messages={clean} side="clean" changes={changes} mark="token" delay0={showBoth ? delay0 + 0.9 : delay0} />}
              </div>
            </article>;
          })}
        </div>
      </section>}

      {step === 4 && run && dataset && <section className="release">
        <div className="release-card">
          <div className="release-file">
            <span className="file-badge"><Icon name="file" size={26} /><span className="check"><Icon name="check" size={13} /></span></span>
            <span><strong>training.jsonl</strong><small>{run.summary.examples ?? dataset.conversation_count} conversations · roles kept</small></span>
          </div>
          <dl className="release-stats">
            <div><dt>removed</dt><dd className="lav">{replacements}</dd></div>
            <div><dt>fields withheld</dt><dd>{withheld}</dd></div>
            <div><dt>snapshot</dt><dd>v{run.summary.source_version ?? dataset.source_version}</dd></div>
          </dl>
        </div>
        <div className="release-secondary">
          <button className="outline-button" disabled={!!downloading} onClick={() => void download('receipt')}>{downloading === 'receipt' ? <span className="spinner" /> : <Icon name="download" size={16} />}Receipt</button>
          <button className="outline-button" disabled={!!downloading} onClick={() => void download('bundle')}>{downloading === 'bundle' ? <span className="spinner" /> : <Icon name="download" size={16} />}ZIP</button>
        </div>
        <div className="release-links">
          <button className="text-button" onClick={() => { setPhase('review'); showSide('clean'); }}><Icon name="back" size={16} />Review</button>
          <button className="text-button" onClick={startOver}><Icon name="restart" size={16} />Start over</button>
        </div>
        {versions && <p className="versions">lance-context {String(versions.lance_context ?? '—')} · datafog-core {String(versions.datafog_core ?? '—')}</p>}
      </section>}
    </main>

    <footer className="actionbar">
      <div className="actionbar-inner">
        {notice && <div className={`notice notice-${notice.type}`} role={notice.type === 'error' ? 'alert' : 'status'}>
          <Icon name={notice.type === 'error' ? 'alert' : 'check'} size={16} /><span>{notice.message}</span>
          <button className="icon-button" aria-label="Dismiss" onClick={() => setNotice(null)}><Icon name="close" size={16} /></button>
        </div>}
        <button className={`primary ${step === 2 ? 'working' : ''}`} onClick={primary.action} disabled={primary.disabled}>
          {primary.spinner ? <span className="spinner dark" /> : primary.icon && <span className="nudge"><Icon name={primary.icon} size={18} /></span>}
          {primary.label}
        </button>
      </div>
    </footer>
  </div>;
}
