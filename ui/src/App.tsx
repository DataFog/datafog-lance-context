import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';

type Stage = 'empty' | 'fetching' | 'importing' | 'imported' | 'running' | 'ready' | 'stale' | 'blocked' | 'expired' | 'error';
type Tab = 'conversations' | 'metadata' | 'receipt';
type View = 'raw' | 'clean' | 'compare';
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

const SAMPLE_PATH = '/samples/support-conversations-v1.jsonl';
const PUBLIC_SAMPLE = `https://datafog-lance-context.sid-5af.workers.dev${SAMPLE_PATH}`;
const GENERATOR_SAMPLE = `https://datafog-lance-context-generator.sid-5af.workers.dev${SAMPLE_PATH}`;
const SOURCE_CACHE_KEY = 'datafog-lance-context:synthetic-source:v1';
const MAX_INPUT_BYTES = 2 * 1024 * 1024;
const entityOptions = [
  { id: 'EMAIL', label: 'Email addresses', example: 'customer@example.com', icon: 'mail' },
  { id: 'PHONE', label: 'Phone numbers', example: 'Personal contact numbers', icon: 'phone' },
  { id: 'SSN', label: 'Social Security numbers', example: 'US identifiers', icon: 'shield' },
  { id: 'CREDIT_CARD', label: 'Credit card numbers', example: 'Validated number patterns', icon: 'card' },
] as const;
const extraOptions = [{ id: 'IP_ADDRESS', label: 'IP addresses' }, { id: 'DATE', label: 'Dates' }, { id: 'ZIP_CODE', label: 'ZIP codes' }];
const initialPolicy: Policy = { entities: ['EMAIL', 'PHONE', 'SSN', 'CREDIT_CARD'], allow_support_email: true };

function Icon({ name, size = 18, className = '' }: { name: string; size?: number; className?: string }) {
  const paths: Record<string, ReactNode> = {
    arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
    upload: <><path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5" /></>,
    file: <><path d="M14 3H5v18h14V8zM14 3v5h5M8 13h8M8 17h5" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z" /><path d="m8 12 3 3 5-6" /></>,
    mail: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m3 7 9 6 9-6" /></>,
    phone: <path d="m7 3 3 5-3 3c2 3 3 4 6 6l3-3 5 3c0 3-2 5-5 4C9 19 5 15 3 8 2 5 4 3 7 3Z" />,
    card: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M3 10h18M7 15h4" /></>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" /></>,
    code: <><path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 20" /></>,
    link: <><path d="m9 15 6-6M8 16l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m0 2 1-1a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0" transform="translate(2 0)" /></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6 7a7 7 0 0 1 11-2l3 3M4 16l3 3a7 7 0 0 0 11-2" /></>,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    trash: <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" /></>,
    alert: <><path d="m12 3 10 18H2zM12 9v5M12 17h.01" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 6v6l4 2" /></>,
    spark: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z" /></>,
    layers: <><path d="m12 3 10 5-10 5L2 8zm-9 10 9 5 9-5M3 18l9 5 9-5" /></>,
    outward: <><path d="M8 4h12v12M20 4 4 20" /></>,
  };
  return <svg aria-hidden="true" className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">{paths[name] || paths.file}</svg>;
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
    throw new ApiError(detail || (response.status === 404 ? 'This session has expired. Reimport your input to continue.' : 'The request could not be completed. Please check the input and retry.'), response.status, body?.error?.code || 'request_failed');
  }
  return body as T;
}

function textValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function MarkedText({ text, changes, messageIndex, side }: { text: string; changes: Change[]; messageIndex: number; side: 'raw' | 'clean' }) {
  const chars = Array.from(text);
  const ranges = changes.filter(c => c.message_index === messageIndex).map(c => ({
    start: side === 'raw' ? c.start : c.output_start, end: side === 'raw' ? c.end : c.output_end, type: c.entity_type,
  })).filter(r => Number.isInteger(r.start) && Number.isInteger(r.end) && r.start >= 0 && r.end > r.start && r.end <= chars.length).sort((a, b) => a.start - b.start);
  const parts: ReactNode[] = [];
  let cursor = 0;
  ranges.forEach((range, index) => {
    if (range.start < cursor) return;
    if (range.start > cursor) parts.push(chars.slice(cursor, range.start).join(''));
    parts.push(<mark key={`${range.start}-${index}`} className={`match-${side}`} title={range.type.replaceAll('_', ' ')}>{chars.slice(range.start, range.end).join('')}</mark>);
    cursor = range.end;
  });
  if (cursor < chars.length) parts.push(chars.slice(cursor).join(''));
  return <>{parts.length ? parts : text}</>;
}

function ConversationPane({ messages, side, changes = [] }: { messages: Message[]; side: 'raw' | 'clean'; changes?: Change[] }) {
  return <div className={`conversation-pane ${side}`}>
    <div className="pane-heading"><span className={`pane-dot ${side}`} />{side === 'raw' ? 'Original' : 'Cleaned'}<span className="pane-label">{side === 'raw' ? 'SOURCE' : 'OUTPUT'}</span></div>
    <div className="messages">
      {messages.map((message, index) => <article className={`message role-${message.role}`} key={`${index}-${message.role}`}>
        <div className="message-heading"><span className="role-avatar">{message.role === 'assistant' ? <Icon name="spark" size={13} /> : message.role === 'user' ? 'C' : <Icon name="code" size={12} />}</span><span>{message.role === 'user' ? 'User' : message.role === 'assistant' ? 'Assistant' : message.role}</span><span className="turn-label">{String(index + 1).padStart(2, '0')}</span></div>
        <p><MarkedText text={message.content} changes={changes} messageIndex={index} side={side} /></p>
      </article>)}
    </div>
  </div>;
}

export default function App() {
  const [stage, setStage] = useState<Stage>('empty');
  const [health, setHealth] = useState<{ status: string; versions: Versions } | null>(null);
  const [healthError, setHealthError] = useState(false);
  const [checkingHealth, setCheckingHealth] = useState(true);
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [policy, setPolicy] = useState<Policy>(initialPolicy);
  const [notice, setNotice] = useState<Notice>(null);
  const [tab, setTab] = useState<Tab>('conversations');
  const [view, setView] = useState<View>('compare');
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  const reviewRef = useRef<HTMLElement>(null);
  const [selected, setSelected] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [showUrl, setShowUrl] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [failureTest, setFailureTest] = useState(false);
  const [filename, setFilename] = useState('');
  const [savedInput, setSavedInput] = useState<SavedInput | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const input = useRef<{ content: string; filename: string } | null>(null);
  const runPolicy = useRef('');
  const busy = stage === 'fetching' || stage === 'importing' || stage === 'running';
  const locked = busy || downloading !== null;
  const validRelease = run?.status === 'ready' && stage === 'ready' && runPolicy.current === JSON.stringify(policy);
  const versions = health?.versions || dataset?.versions;
  const activeConversation = dataset?.conversations[selected];
  const activeExample = run?.examples?.find(example => example.raw?.provenance?.session_id === activeConversation?.session_id) || run?.examples?.[selected];
  const activeExampleIndex = activeExample ? run!.examples.indexOf(activeExample) : selected;
  const visibleMetadata = (run?.metadata_review || []).filter(item => item.example_index === undefined || item.example_index === activeExampleIndex);
  const rawMessages = activeExample?.raw?.messages || activeConversation?.messages || [];
  const cleanMessages = activeExample?.clean?.messages;
  const replacements = run?.summary?.replacements ?? 0;
  const displayView: View = cleanMessages ? (compact && view === 'compare' ? 'clean' : view) : 'raw';
  const dirty = stage === 'stale';
  const intentionalFailure = failureTest && run?.error?.code === 'injected_failure';

  async function checkHealth() {
    setCheckingHealth(true); setHealthError(false);
    try { const result = await api<{ status: string; versions: Versions }>('/api/health'); setHealth(result); }
    catch { setHealthError(true); }
    finally { setCheckingHealth(false); }
  }

  useEffect(() => {
    void checkHealth();
    try {
      const value = localStorage.getItem(SOURCE_CACHE_KEY);
      if (value) {
        const saved = JSON.parse(value) as Partial<SavedInput>;
        if (typeof saved.content === 'string' && typeof saved.filename === 'string' && typeof saved.savedAt === 'string' && new Blob([saved.content]).size <= MAX_INPUT_BYTES) setSavedInput(saved as SavedInput);
        else localStorage.removeItem(SOURCE_CACHE_KEY);
      }
    } catch { /* Storage can be unavailable in private or restricted browsers. */ }
    return () => controller.current?.abort();
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const update = () => setCompact(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (compact && (stage === 'ready' || stage === 'blocked')) {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      reviewRef.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    }
  }, [stage, compact]);

  function cacheSource(content: string, name: string): boolean {
    if (new Blob([content]).size > MAX_INPUT_BYTES) return false;
    const saved: SavedInput = { content, filename: name, savedAt: new Date().toISOString() };
    try { localStorage.setItem(SOURCE_CACHE_KEY, JSON.stringify(saved)); setSavedInput(saved); return true; }
    catch { setSavedInput(null); return false; }
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
    return { id: generation.current, signal: controller.current.signal };
  }

  function handleFailure(error: unknown, id: number) {
    if (id !== generation.current || (error instanceof DOMException && error.name === 'AbortError')) return;
    const expired = error instanceof ApiError && error.status === 404;
    if (error instanceof ApiError && error.code === 'network_error') setHealthError(true);
    setStage(expired ? 'expired' : 'error');
    setNotice({ type: 'error', message: error instanceof Error ? error.message : 'Something interrupted this run. Please retry.' });
  }

  async function importText(content: string, name: string, request?: { id: number; signal: AbortSignal }) {
    const current = request || newRequest();
    setStage('importing'); setNotice(null); setRun(null); setDataset(null); setSelected(0); setTab('conversations'); setFailureTest(false);
    clearSourceCache();
    input.current = { content, filename: name }; setFilename(name);
    try {
      if (new Blob([content]).size > MAX_INPUT_BYTES) throw new ApiError('Choose a JSONL file of 2 MiB or less.');
      const result = await api<Dataset>('/api/datasets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content, filename: name }), signal: current.signal });
      if (current.id !== generation.current) return;
      setDataset(result); setStage('imported'); setShowUrl(false);
      setHealthError(false);
      if (!cacheSource(content, name)) setNotice({ type: 'info', message: 'Imported. Browser storage unavailable.' });
      if (result.versions) setHealth(previous => ({ status: previous?.status || 'ok', versions: result.versions }));
    } catch (error) { handleFailure(error, current.id); }
  }

  async function fetchSampleText(url: string, signal: AbortSignal) {
      const parsed = new URL(url, window.location.origin);
      const sameSample = parsed.origin === window.location.origin && parsed.pathname === SAMPLE_PATH;
      if (!sameSample && parsed.href !== PUBLIC_SAMPLE && parsed.href !== GENERATOR_SAMPLE) throw new ApiError('Use the published sample link, or choose a local JSONL file.');
      let response = await fetch(parsed.href, { signal, credentials: 'omit' });
      if (!response.ok && sameSample) response = await fetch('/api/sample', { signal });
      if (!response.ok) throw new ApiError('The sample could not be downloaded. Try the direct download link or choose a file.');
      return response.text();
  }

  async function loadSample(url = SAMPLE_PATH) {
    const request = newRequest();
    setStage('fetching'); setNotice(null); setRun(null); setDataset(null); setSelected(0);
    try {
      const content = await fetchSampleText(url, request.signal);
      if (request.id !== generation.current) return;
      await importText(content, 'support-conversations-v1.jsonl', request);
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
      const content = await fetchSampleText(SAMPLE_PATH, request.signal);
      if (request.id !== generation.current) return;
      const saved = cacheSource(content, 'support-conversations-v1.jsonl');
      saveBlob(new Blob([content], { type: 'application/x-ndjson' }), 'support-conversations-v1.jsonl');
      setStage(dataset ? 'imported' : 'empty');
      setNotice({ type: 'info', message: saved ? 'Downloaded.' : 'Downloaded. Browser storage unavailable.' });
    } catch (error) { handleFailure(error, request.id); }
  }

  async function loadFile(file: File) {
    const request = newRequest();
    setStage('importing'); setNotice(null); setRun(null); setDataset(null);
    try { if (file.size > MAX_INPUT_BYTES) throw new ApiError('Choose a JSONL file of 2 MiB or less.'); const content = await file.text(); if (request.id === generation.current) await importText(content, file.name, request); }
    catch (error) { handleFailure(error, request.id); }
    if (fileInput.current) fileInput.current.value = '';
  }

  async function onDrop(event: DragEvent) {
    event.preventDefault(); setDragging(false);
    if (locked) return;
    if (event.dataTransfer.files.length > 1) { setNotice({ type: 'error', message: 'Choose one JSONL file at a time.' }); return; }
    if (event.dataTransfer.files.length) { await loadFile(event.dataTransfer.files[0]); return; }
    const raw = event.dataTransfer.getData('text/uri-list') || event.dataTransfer.getData('text/plain');
    const url = raw.split('\n').find(line => line.trim() && !line.startsWith('#'))?.trim();
    if (url) await loadSample(url);
    else setNotice({ type: 'error', message: 'Drop a JSONL file or the published sample link here.' });
  }

  function updatePolicy(next: Policy) {
    setPolicy(next); setNotice(null);
    if (run) setStage('stale');
  }

  function toggleEntity(entity: string) {
    updatePolicy({ ...policy, entities: policy.entities.includes(entity) ? policy.entities.filter(value => value !== entity) : [...policy.entities, entity] });
  }

  async function runExport(injectFailure = false) {
    if (!dataset || locked) return;
    const current = newRequest();
    const currentPolicy = JSON.stringify(policy);
    setStage('running'); setNotice(null); setRun(null); setFailureTest(injectFailure);
    try {
      const result = await api<Run>('/api/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataset_id: dataset.dataset_id, policy, inject_failure: injectFailure }), signal: current.signal });
      if (current.id !== generation.current) return;
      runPolicy.current = currentPolicy;
      setHealthError(false);
      setRun(result); setStage(result.status);
      if (result.status === 'blocked') setNotice({ type: 'info', message: result.error?.message || 'Cleanup stopped. No completed bundle was released.' });
    } catch (error) { handleFailure(error, current.id); }
  }

  async function download(kind: 'bundle' | 'training' | 'receipt') {
    if (!validRelease || !run || downloading) return;
    setDownloading(kind); setNotice(null);
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(run.run_id)}/${kind}`);
      if (!response.ok) throw new ApiError(response.status === 404 ? 'This release has expired. Reimport your input to create it again.' : 'The download did not complete. Please retry.', response.status);
      const blob = await response.blob();
      saveBlob(blob, kind === 'bundle' ? 'datafog-training-release.zip' : kind === 'training' ? 'training.jsonl' : 'privacy-receipt.json');
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) setStage('expired');
      setNotice({ type: 'error', message: error instanceof Error ? error.message : 'The download did not complete. Please retry.' });
    } finally { setDownloading(null); }
  }

  function reset() {
    newRequest(); setDataset(null); setRun(null); setStage('empty'); setNotice(null); setSelected(0); setFilename(''); setTab('conversations'); setFailureTest(false); input.current = null;
    if (!clearSourceCache()) setNotice({ type: 'error', message: 'Browser storage could not be cleared. Clear site data in browser settings.' });
  }

  const statusLabel = stage === 'running' ? 'Processing export' : stage === 'ready' ? 'Release ready' : stage === 'blocked' ? 'Release blocked' : stage === 'stale' ? 'Policy changed' : stage === 'expired' ? 'Session expired' : 'Ready to review';

  return <div className="app-shell" onDragOver={event => event.preventDefault()} onDrop={event => event.preventDefault()}>
    <header className="site-header page-width">
      <a href="https://www.lancedb.com/" target="_blank" rel="noreferrer" className="brand" aria-label="LanceDB website"><img src="https://cdn.prod.website-files.com/69a866b324926425eccc4cf5/69ab0db86188576e86d098f7_c1b5a4653a6fa4cc4b2ff7641e1276b1_lanceDB_logo.avif" width="146" height="30" alt="LanceDB" /></a>
      <div className="header-links"><a href="https://github.com/DataFog/datafog-lance-context" target="_blank" rel="noreferrer" className="source-link"><Icon name="code" size={17} /><span>Source</span><Icon name="outward" size={13} /></a></div>
    </header>

    <main className="page-width">
      <section className="intro">
        <div><span className="eyebrow">LANCE-CONTEXT</span><h1>Review a training export.</h1></div>
        <div className="engine-info"><div className="engine-status"><span className={`status-dot ${health && !healthError ? 'online' : checkingHealth ? 'checking' : 'offline'}`} /><span>{checkingHealth ? 'Connecting…' : healthError ? 'Connection interrupted' : 'Engine online'}</span>{healthError && <button className="text-button" onClick={() => void checkHealth()}>Retry</button>}</div><div className="engine-versions"><span>lance-context <b>{textValue(versions?.lance_context)}</b></span><span>datafog-core <b>{textValue(versions?.datafog_core)}</b></span></div></div>
      </section>

      <div className={`pipeline state-${stage}`} aria-label={`Export flow: ${statusLabel}`}>
        <div className={`pipeline-step ${dataset ? 'done' : 'current'}`}><span className="step-icon">{dataset ? <Icon name="check" size={15} /> : <Icon name="layers" size={17} />}</span><span>Source</span>{dataset && <small>v{dataset.source_version}</small>}</div><div className="pipeline-connector" />
        <div className={`pipeline-step ${stage === 'running' ? 'current processing' : run?.status === 'ready' && !dirty ? 'done' : stage === 'blocked' ? 'failed' : ''}`}><span className="step-icon">{stage === 'running' ? <span className="spinner" /> : run?.status === 'ready' && !dirty ? <Icon name="check" size={15} /> : <Icon name="shield" size={17} />}</span><span>Clean</span></div><div className="pipeline-connector" />
        <div className={`pipeline-step ${validRelease ? 'done release-done' : stage === 'blocked' ? 'failed' : ''}`}><span className="step-icon">{validRelease ? <Icon name="check" size={15} /> : stage === 'blocked' ? <Icon name="close" size={15} /> : <Icon name="file" size={17} />}</span><span>Release</span></div>
      </div>


      {notice && <div className={`notice notice-${notice.type}`} role={notice.type === 'error' ? 'alert' : 'status'}><Icon name={notice.type === 'error' ? 'alert' : 'shield'} /><div>{notice.message}{stage === 'expired' && input.current && <button className="inline-link" onClick={() => input.current && void importText(input.current.content, input.current.filename)}>Reimport input<Icon name="arrow" size={14} /></button>}</div><button className="icon-button" aria-label="Dismiss message" onClick={() => setNotice(null)}><Icon name="close" size={18} /></button></div>}

      {savedInput && !dataset && <section className="saved-input-card" aria-label="Saved source"><span className="saved-file-icon"><Icon name="file" size={23} /></span><div className="saved-file-copy"><strong>{savedInput.filename}</strong></div><button className="button button-outline" disabled={locked} onClick={() => void importText(savedInput.content, savedInput.filename)}>Load saved file<Icon name="arrow" size={15} /></button><button className="icon-button saved-trash" aria-label="Remove saved file" title="Remove saved file" disabled={locked} onClick={reset}><Icon name="trash" size={20} /></button></section>}

      <input ref={fileInput} type="file" accept=".jsonl,.ndjson,application/x-ndjson,text/plain" className="visually-hidden" aria-label="Choose a conversation JSONL file" onChange={event => { const file = event.target.files?.[0]; if (file) void loadFile(file); }} />

      {!dataset && <section className={`import-card ${dragging ? 'dragging' : ''}`} onDragOver={event => { event.preventDefault(); if (!locked) setDragging(true); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }} onDrop={event => void onDrop(event)} aria-busy={busy}>
        <div className="import-heading"><span className="eyebrow">01 / SOURCE</span><span className="file-format">JSONL</span></div>
        <div className="drop-zone"><span className="upload-symbol">{busy ? <span className="spinner" /> : <Icon name="upload" size={29} />}</span><h2>{stage === 'fetching' ? 'Downloading sample…' : stage === 'importing' ? 'Creating Lance snapshot…' : 'Add conversations.'}</h2><button className="button button-primary" disabled={locked} onClick={() => fileInput.current?.click()}><Icon name="upload" size={17} />Choose file</button></div>
        <div className="sample-actions"><button className="button button-outline" disabled={locked} onClick={() => void loadSample()}>Load the sample<Icon name="arrow" size={17} /></button><a href={SAMPLE_PATH} download="support-conversations-v1.jsonl" className={`button button-outline sample-download ${locked ? 'disabled' : ''}`} aria-disabled={locked} draggable onClick={event => { event.preventDefault(); if (!locked) void downloadSample(); }}><Icon name="download" size={17} />Download sample</a></div>
        <div className="import-secondary"><button className="text-button" disabled={locked} onClick={() => setShowUrl(!showUrl)}><Icon name="link" size={16} />Paste sample link</button></div>
        {showUrl && <form className="url-form" onSubmit={event => { event.preventDefault(); void loadSample(urlInput.trim()); }}><label className="visually-hidden" htmlFor="sample-url">Published sample URL</label><input id="sample-url" type="url" placeholder={PUBLIC_SAMPLE} value={urlInput} onChange={event => setUrlInput(event.target.value)} disabled={locked} required /><button className="button button-primary" type="submit" disabled={locked}>Load<Icon name="arrow" size={16} /></button></form>}
      </section>}

      {dataset && <section className={`workspace ${dragging ? 'dragging' : ''}`} onDragOver={event => { event.preventDefault(); if (!locked) setDragging(true); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }} onDrop={event => void onDrop(event)} aria-busy={busy}>
        <div className="source-bar"><span className="source-file-icon"><Icon name="file" size={21} /></span><div className="source-file"><strong>{filename || 'Conversation source'}</strong><span>{dataset.conversation_count} conversations · {dataset.message_count} messages · snapshot {dataset.source_version}</span></div><div className="source-actions"><button className="button button-outline" onClick={() => fileInput.current?.click()} disabled={locked}><Icon name="upload" size={16} /><span>Replace</span></button><button className="icon-button" aria-label="Remove saved file" title="Remove saved file and reset workspace" onClick={reset} disabled={downloading !== null}><Icon name="trash" size={20} /></button></div></div>

        <div className="workspace-body">
          <aside className="policy-panel"><div className="panel-heading"><span className="eyebrow">02 / POLICY</span><h2>Privacy rules</h2></div><fieldset disabled={locked}><legend className="visually-hidden">Personal data types to redact</legend><div className="entity-options">{entityOptions.map(option => <label className={`entity-option ${policy.entities.includes(option.id) ? 'checked' : ''}`} key={option.id}><input type="checkbox" checked={policy.entities.includes(option.id)} onChange={() => toggleEntity(option.id)} /><span className="custom-check"><Icon name="check" size={14} /></span><span className="entity-icon"><Icon name={option.icon} size={18} /></span><span>{option.id === 'SSN' ? 'Social Security' : option.id === 'CREDIT_CARD' ? 'Credit cards' : option.label}</span></label>)}</div><details className="extra-patterns"><summary>More patterns<Icon name="arrow" size={15} /></summary><div>{extraOptions.map(option => <label key={option.id}><input type="checkbox" checked={policy.entities.includes(option.id)} onChange={() => toggleEntity(option.id)} />{option.label}</label>)}</div></details><label className="allow-rule"><span><strong>Keep public support email</strong><small>support@example.com</small></span><input className="toggle-input" type="checkbox" checked={policy.allow_support_email} onChange={() => updatePolicy({ ...policy, allow_support_email: !policy.allow_support_email })} /><span className="toggle-visual" /></label></fieldset>{policy.entities.length === 0 && <p className="policy-selection-error" role="status">Select at least one pattern.</p>}<div className="policy-actions"><button className="button button-primary run-button" disabled={!dataset || locked || policy.entities.length === 0} onClick={() => void runExport()}>{stage === 'running' ? <span className="spinner" /> : <Icon name="shield" size={18} />}{stage === 'running' ? 'Processing export…' : stage === 'stale' ? 'Rerun with this policy' : 'Run privacy export'}{stage !== 'running' && <Icon name="arrow" size={18} />}</button><button className="button button-outline failure-button" disabled={!dataset || locked || policy.entities.length === 0} onClick={() => void runExport(true)}><Icon name="alert" size={16} />Test a blocked release</button></div></aside>

          <section ref={reviewRef} className={`review-area ${dirty ? 'has-stale-result' : ''}`}>
            <div className="panel-heading review-heading"><span className="eyebrow">03 / REVIEW</span><span className={`release-chip release-${stage}`} aria-live="polite">{stage === 'running' ? <span className="spinner" /> : <span className="release-status-dot" />}{statusLabel}</span></div>
            <div className="conversation-selector"><label htmlFor="conversation-select">Conversation</label><select id="conversation-select" value={selected} onChange={event => setSelected(Number(event.target.value))}>{dataset.conversations.map((conversation, index) => <option value={index} key={`${conversation.session_id}-${index}`}>{String(index + 1).padStart(2, '0')} — {typeof conversation.metadata?.scenario === 'string' ? conversation.metadata.scenario.replaceAll('_', ' ') : `Conversation ${index + 1}`}</option>)}</select></div>

            <div className="review-tabs" role="tablist" aria-label="Review views">{(['conversations', 'metadata', 'receipt'] as Tab[]).map((value, index, tabs) => <button role="tab" id={`tab-${value}`} aria-selected={tab === value} aria-controls={`panel-${value}`} tabIndex={tab === value ? 0 : -1} className={tab === value ? 'active' : ''} key={value} onClick={() => setTab(value)} onKeyDown={event => { const next = event.key === 'ArrowRight' ? tabs[(index + 1) % tabs.length] : event.key === 'ArrowLeft' ? tabs[(index - 1 + tabs.length) % tabs.length] : event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[tabs.length - 1] : null; if (next) { event.preventDefault(); setTab(next); document.getElementById(`tab-${next}`)?.focus(); } }}>{value === 'conversations' ? 'Messages' : value === 'metadata' ? 'Metadata' : 'Receipt'}{value === 'metadata' && !!visibleMetadata.length && <span>{visibleMetadata.length}</span>}</button>)}</div>

            {dirty && <div className="stale-banner"><Icon name="refresh" size={17} />Policy changed. Rerun to release current output.</div>}
            {stage === 'running' && <div className="processing-banner" role="status"><span className="spinner" /><span>{failureTest ? 'Running the intentional failure test…' : 'Exporting, cleaning, and checking output…'}</span></div>}
            {stage === 'blocked' && <div className="blocked-banner" role="status"><Icon name="shield" size={25} /><div><strong>{intentionalFailure ? 'Failure test passed. Release blocked.' : 'Release blocked.'}</strong></div></div>}

            <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="tab-panel" key={`${tab}-${run?.run_id || 'source'}`}>
              {tab === 'conversations' && <><div className="message-controls"><div className="view-toggle" role="group" aria-label="Message view"><button aria-pressed={displayView === 'raw'} onClick={() => setView('raw')}>Original</button><button aria-pressed={displayView === 'clean'} disabled={!cleanMessages} onClick={() => setView('clean')}>Cleaned</button>{!compact && <button aria-pressed={displayView === 'compare'} disabled={!cleanMessages} onClick={() => setView('compare')}>Compare</button>}</div>{activeExample && <span className="change-count">{activeExample.changes.length} replacements</span>}</div><div className={`comparison mode-${displayView}`} key={`${run?.run_id || 'source'}-${selected}-${displayView}`}>{(displayView === 'raw' || displayView === 'compare') && <ConversationPane messages={rawMessages} side="raw" changes={activeExample?.changes} />}{cleanMessages && (displayView === 'clean' || displayView === 'compare') && <ConversationPane messages={cleanMessages} side="clean" changes={activeExample?.changes} />}</div>{cleanMessages && <div className="comparison-legend"><span><i className="legend-raw" />Original match</span><span><i className="legend-clean" />Replacement</span></div>}</>}

              {tab === 'metadata' && <div className="metadata-panel"><div className="metadata-context"><strong>{typeof activeConversation?.metadata?.scenario === 'string' ? activeConversation.metadata.scenario.replaceAll('_', ' ') : `Conversation ${selected + 1}`}</strong><span>{visibleMetadata.length} field decisions</span></div>{visibleMetadata.length ? <div className="metadata-table-wrap" tabIndex={0} aria-label="Metadata decisions, scroll horizontally if needed"><table className="metadata-table"><thead><tr><th>Field</th><th>Original</th><th>Action</th><th>Released</th></tr></thead><tbody>{visibleMetadata.map((item, index) => <tr key={`${item.field}-${index}`}><th scope="row">{item.field}</th><td><code>{textValue(item.before)}</code></td><td><span className={`action-tag action-${item.action.toLowerCase()}`}>{item.action.replaceAll('_', ' ')}</span></td><td><code>{textValue(item.after)}</code></td></tr>)}</tbody></table></div> : <div className="empty-view">No release data.</div>}</div>}

              {tab === 'receipt' && <div className="receipt-panel">{run?.receipt ? <><div className="receipt-summary"><div><span>Source snapshot</span><strong>v{run.summary.source_version ?? dataset.source_version}</strong></div><div><span>Policy hash</span><strong className="mono">{String(run.summary.policy_hash || '').slice(0, 12) || 'In receipt'}</strong></div><div><span>Replacements</span><strong>{replacements}</strong></div><div><span>Processing time</span><strong>{typeof run.summary.duration_ms === 'number' ? `${run.summary.duration_ms.toLocaleString(undefined, { maximumFractionDigits: 1 })} ms` : 'In receipt'}</strong></div></div><details className="receipt-json" open><summary><Icon name="code" size={17} />Release receipt<span>JSON</span></summary><pre tabIndex={0}>{JSON.stringify(run.receipt, null, 2)}</pre></details><button className="button button-outline" disabled={!validRelease || !!downloading} onClick={() => void download('receipt')}><Icon name="download" size={17} />Download receipt</button></> : <div className="empty-view">{stage === 'blocked' ? 'No receipt.' : 'No receipt.'}</div>}</div>}
            </div>

            {run?.status === 'ready' && <div className="release-summary"><div className="summary-numbers"><div><strong>{run.summary.examples ?? dataset.conversation_count}</strong><span>Examples</span></div><div><strong>{replacements}</strong><span>Replacements</span></div><div><strong>{run.summary.examples_changed ?? 0}</strong><span>Changed</span></div></div><button className="button button-primary" disabled={!validRelease || !!downloading} onClick={() => void download('bundle')}>{downloading === 'bundle' ? <span className="spinner" /> : <Icon name="download" size={18} />}Download release<Icon name="arrow" size={18} /></button><div className="secondary-downloads"><button disabled={!validRelease || !!downloading} onClick={() => void download('training')}>Training JSONL<Icon name="download" size={14} /></button><button disabled={!validRelease || !!downloading} onClick={() => void download('receipt')}>Receipt<Icon name="download" size={14} /></button></div></div>}
          </section>
        </div>
      </section>}
    </main>


  </div>;
}
