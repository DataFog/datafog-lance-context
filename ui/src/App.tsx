import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';

type Stage = 'empty' | 'fetching' | 'importing' | 'imported' | 'running' | 'ready' | 'stale' | 'blocked' | 'expired' | 'error';
type Tab = 'conversations' | 'metadata' | 'receipt';
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
  catch (error) { if (error instanceof DOMException && error.name === 'AbortError') throw error; throw new ApiError('The connection was interrupted. Your input is still available to retry.', 0, 'network_error'); }
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
    <div className="pane-heading"><span className={`pane-dot ${side}`} />{side === 'raw' ? 'Original conversation' : 'Cleaned for training'}<span className="pane-label">{side === 'raw' ? 'SOURCE' : 'OUTPUT'}</span></div>
    <div className="messages">
      {messages.map((message, index) => <article className={`message role-${message.role}`} key={`${index}-${message.role}`}>
        <div className="message-heading"><span className="role-avatar">{message.role === 'assistant' ? <Icon name="spark" size={13} /> : message.role === 'user' ? 'C' : <Icon name="code" size={12} />}</span><span>{message.role === 'user' ? 'Customer' : message.role === 'assistant' ? 'Support agent' : message.role}</span><span className="turn-label">{String(index + 1).padStart(2, '0')}</span></div>
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
  const dirty = stage === 'stale';

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
      if (new Blob([content]).size > MAX_INPUT_BYTES) throw new ApiError('Choose a synthetic JSONL file of 2 MiB or less.');
      const result = await api<Dataset>('/api/datasets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content, filename: name }), signal: current.signal });
      if (current.id !== generation.current) return;
      setDataset(result); setStage('imported'); setShowUrl(false);
      setHealthError(false);
      if (!cacheSource(content, name)) setNotice({ type: 'info', message: 'The source was imported, but this browser could not save a copy. Keep the downloaded file so you can upload it again.' });
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
      setNotice({ type: 'info', message: saved ? 'Sample downloaded and saved in this browser. Load the saved file, or drop the download into the workspace.' : 'Sample downloaded. Browser storage is unavailable, so keep the file and drop it into the workspace.' });
    } catch (error) { handleFailure(error, request.id); }
  }

  async function loadFile(file: File) {
    const request = newRequest();
    setStage('importing'); setNotice(null); setRun(null); setDataset(null);
    try { if (file.size > MAX_INPUT_BYTES) throw new ApiError('Choose a synthetic JSONL file of 2 MiB or less.'); const content = await file.text(); if (request.id === generation.current) await importText(content, file.name, request); }
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
    if (!clearSourceCache()) setNotice({ type: 'error', message: 'The workspace was reset, but this browser could not remove its saved copy. Clear site storage in your browser settings.' });
  }

  const statusLabel = stage === 'running' ? 'Processing export' : stage === 'ready' ? 'Release ready' : stage === 'blocked' ? 'Release blocked' : stage === 'stale' ? 'Policy changed' : stage === 'expired' ? 'Session expired' : 'Ready to review';

  return <div className="app-shell" onDragOver={event => event.preventDefault()} onDrop={event => { if (!event.defaultPrevented) { event.preventDefault(); } }}>
    <header className="site-header page-width">
      <a href="/" className="brand" aria-label="DataFog and Lance context demo"><span className="brand-mark"><i /><i /><i /></span><span>datafog</span><span className="brand-cross">×</span><span className="lance-word">Lance</span></a>
      <div className="header-links"><span className="community-label">Community integration</span><a href="https://github.com/DataFog/datafog-lance-context" target="_blank" rel="noreferrer" className="source-link"><Icon name="code" size={16} />View source<Icon name="outward" size={12} /></a></div>
    </header>

    <main className="page-width">
      <section className="hero">
        <div className="hero-copy"><div className="eyebrow"><span />FROM MEMORY TO MODEL</div><h1>A training set<br />you can <em>explain.</em></h1><p>Turn agent conversations into a privacy-reviewed training cut. Real Lance storage. Real DataFog cleanup. A clear record of what changed.</p></div>
        <div className="hero-aside"><div className="engine-status"><span className={`status-dot ${health && !healthError ? 'online' : checkingHealth ? 'checking' : 'offline'}`} /><span>{checkingHealth ? 'Connecting to the real engines' : healthError ? 'Engine connection needs a retry' : 'Connected to the real engines'}</span>{healthError && <button className="text-button" onClick={() => void checkHealth()}>Retry</button>}</div><div className="engine-versions"><span>lance-context <b>{textValue(versions?.lance_context)}</b></span><span>datafog-core <b>{textValue(versions?.datafog_core)}</b></span></div><p className="synthetic-notice"><Icon name="shield" size={16} />Public demo · synthetic data only.<br />Uploaded text goes to this demo’s server, never to the sample generator.</p></div>
      </section>

      <nav className="journey" aria-label="Demo steps"><div className={`journey-step ${dataset ? 'done' : 'active'}`}><span>{dataset ? <Icon name="check" size={13} /> : '01'}</span>Add conversations</div><div className="journey-line" /><div className={`journey-step ${dataset && !run ? 'active' : run ? 'done' : ''}`}><span>{run ? <Icon name="check" size={13} /> : '02'}</span>Choose what stays private</div><div className="journey-line" /><div className={`journey-step ${run ? 'active' : ''}`}><span>03</span>Review the release</div><span className="journey-caption">One source. A traceable training cut.</span></nav>

      {notice && <div className={`notice notice-${notice.type}`} role={notice.type === 'error' ? 'alert' : 'status'}><Icon name={notice.type === 'error' ? 'alert' : 'shield'} /><div>{notice.message}{stage === 'expired' && input.current && <button className="inline-link" onClick={() => input.current && void importText(input.current.content, input.current.filename)}>Reimport the same input<Icon name="arrow" size={13} /></button>}</div><button className="icon-button" aria-label="Dismiss message" onClick={() => setNotice(null)}><Icon name="close" size={16} /></button></div>}

      {savedInput && !dataset && <section className="saved-input-card" aria-label="Saved synthetic source"><span className="saved-file-icon"><Icon name="file" size={21} /></span><div><strong>{savedInput.filename}</strong><p>Saved in this browser until you remove it. Load it into a fresh Lance context.</p></div><button className="button button-outline button-small" disabled={locked} onClick={() => void importText(savedInput.content, savedInput.filename)}>Load saved file<Icon name="arrow" size={13} /></button><button className="icon-button saved-trash" aria-label="Remove saved file" title="Remove saved file" disabled={locked} onClick={reset}><Icon name="trash" size={17} /></button></section>}

      <input ref={fileInput} type="file" accept=".jsonl,.ndjson,application/x-ndjson,text/plain" className="visually-hidden" aria-label="Choose a synthetic conversation JSONL file" onChange={event => { const file = event.target.files?.[0]; if (file) void loadFile(file); }} />

      {!dataset && <section className="import-layout">
        <div className={`drop-zone ${dragging ? 'dragging' : ''} ${busy ? 'is-busy' : ''}`} onDragOver={event => { event.preventDefault(); if (!locked) setDragging(true); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }} onDrop={event => void onDrop(event)} aria-busy={busy}>
          <div className="paper-stack" aria-hidden="true"><div /><div /><div><span /><span /><span /><i><Icon name="upload" size={18} /></i></div></div>
          <div className="eyebrow">START WITH THE SOURCE</div><h2>{stage === 'fetching' ? 'Fetching the sample…' : stage === 'importing' ? 'Opening a real Lance snapshot…' : 'Your conversations go here.'}</h2><p>{busy ? 'Validating the input and preparing the source. This first request may wake a sleeping demo server.' : 'Drop a synthetic JSONL file or the public sample link. We’ll create a versioned source before changing anything.'}</p>
          <button className="button button-dark" disabled={locked} onClick={() => fileInput.current?.click()}>{busy ? <span className="spinner" /> : <Icon name="upload" size={16} />}{busy ? 'Preparing conversations' : 'Choose a JSONL file'}</button>
          <button className="text-button url-toggle" disabled={locked} onClick={() => setShowUrl(!showUrl)}><Icon name="link" size={14} />Or paste the sample link</button>
          {showUrl && <form className="url-form" onSubmit={event => { event.preventDefault(); void loadSample(urlInput.trim()); }}><label className="visually-hidden" htmlFor="sample-url">Published sample URL</label><input id="sample-url" type="url" placeholder={PUBLIC_SAMPLE} value={urlInput} onChange={event => setUrlInput(event.target.value)} disabled={locked} required /><button className="button button-dark" type="submit" disabled={locked}>Load<Icon name="arrow" size={14} /></button></form>}
          <span className="input-footnote">JSONL · one conversation per line · chat fine-tuning</span>
        </div>
        <aside className="sample-card"><div className="sample-card-top"><span className="sample-badge"><Icon name="spark" size={13} />READY FOR THE DEMO</span><span className="sample-file-type">.jsonl</span></div><h3>Start with a<br />realistic sample.</h3><p>Support conversations with known synthetic identifiers, useful details, and a few privacy traps.</p><div className="sample-traits"><span><Icon name="check" size={14} />Generated narrative, labeled test cases</span><span><Icon name="check" size={14} />Personal data inside metadata, too</span><span><Icon name="check" size={14} />Static download. No account needed.</span></div><button className="button button-sage" disabled={locked} onClick={() => void loadSample()}>Load the sample<Icon name="arrow" size={16} /></button><a href={SAMPLE_PATH} download="support-conversations-v1.jsonl" className={`sample-download ${locked ? 'disabled' : ''}`} aria-disabled={locked} draggable onClick={event => { event.preventDefault(); if (!locked) void downloadSample(); }}><Icon name="download" size={14} />Download sample<span>saved on your device and in this browser</span></a><div className="sample-bottom"><Icon name="layers" size={14} /><span>Drag the sample link or downloaded file<br />into the workspace to begin.</span></div></aside>
      </section>}

      {dataset && <section className={`workspace ${dirty ? 'has-stale-result' : ''} ${dragging ? 'dragging' : ''}`} onDragOver={event => { event.preventDefault(); if (!locked) setDragging(true); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }} onDrop={event => void onDrop(event)} aria-busy={busy}>
        <div className="source-bar"><div className="source-file-icon"><Icon name="file" size={19} /></div><div className="source-file"><strong>{filename || 'Conversation source'}</strong><span>{dataset.conversation_count} conversations · {dataset.message_count} messages · Lance version {dataset.source_version}{savedInput ? ' · Saved in this browser' : ''}</span></div><span className="snapshot-tag"><span />Source unchanged</span><button className="button button-small button-outline" onClick={() => fileInput.current?.click()} disabled={locked}><Icon name="upload" size={13} />Replace</button><button className="icon-button" aria-label="Remove saved file" title="Remove saved file and reset workspace" onClick={reset} disabled={downloading !== null}><Icon name="trash" size={17} /></button></div>

        <div className="workspace-body">
          <aside className="conversation-list"><div className="list-heading"><span>CONVERSATIONS</span><b>{dataset.conversation_count}</b></div><div className="conversation-options" role="listbox" aria-label="Conversations">{dataset.conversations.map((conversation, index) => <button role="option" aria-selected={selected === index} className={`conversation-option ${selected === index ? 'selected' : ''}`} onClick={() => setSelected(index)} key={`${conversation.session_id}-${index}`}><span className="conversation-number">{String(index + 1).padStart(2, '0')}</span><span><strong>{typeof conversation.metadata?.scenario === 'string' ? conversation.metadata.scenario.replaceAll('_', ' ') : `Conversation ${index + 1}`}</strong><small>{conversation.messages.length} messages<span> · </span>{conversation.tenant || 'Synthetic source'}</small></span>{selected === index && <Icon name="arrow" size={13} />}</button>)}</div><div className="source-note"><Icon name="layers" size={18} /><p>Every run starts from this same source version.</p><a href="https://github.com/lance-format/lance-context/pull/111" target="_blank" rel="noreferrer">Built on lance-context export<Icon name="outward" size={11} /></a></div></aside>

          <div className="review-area">
            <div className="review-toolbar"><div className="review-tabs" role="tablist" aria-label="Review views">{(['conversations', 'metadata', 'receipt'] as Tab[]).map(value => <button role="tab" id={`tab-${value}`} aria-selected={tab === value} aria-controls={`panel-${value}`} className={tab === value ? 'active' : ''} key={value} onClick={() => setTab(value)}>{value === 'conversations' ? 'Conversation' : value === 'metadata' ? 'Metadata' : 'Receipt'}{value === 'metadata' && !!visibleMetadata.length && <span>{visibleMetadata.length}</span>}</button>)}</div><span className={`release-chip release-${stage}`} aria-live="polite">{stage === 'running' ? <span className="spinner" /> : <span />}{statusLabel}</span></div>
            {dirty && <div className="stale-banner"><Icon name="refresh" size={14} />The policy changed. Run again to create a current release.</div>}
            {stage === 'running' && <div className="processing-banner" role="status"><span className="spinner" /><div><strong>{failureTest ? 'Running the intentional failure test' : 'Lance export → Core cleanup → release checks'}</strong><span>Results appear when the real pipeline finishes. No file is ready yet.</span></div></div>}
            {stage === 'blocked' && <div className="blocked-banner" role="status"><span className="blocked-symbol"><Icon name="shield" size={20} /></span><div><strong>{failureTest ? 'The failure test worked. Release blocked.' : 'This export did not pass its release checks.'}</strong><p>No completed training bundle was published. Retry a normal export to continue.</p></div></div>}

            <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="tab-panel">
              {tab === 'conversations' && <><div className="conversation-title"><div><span className="eyebrow">CONVERSATION {String(selected + 1).padStart(2, '0')}</span><h3>{typeof activeConversation?.metadata?.scenario === 'string' ? activeConversation.metadata.scenario.replaceAll('_', ' ') : 'Review the conversation'}</h3></div>{activeExample?.changes?.length ? <span className="change-count"><span />{activeExample.changes.length} replacements</span> : null}</div><div className="comparison"><ConversationPane messages={rawMessages} side="raw" changes={activeExample?.changes} />{cleanMessages ? <ConversationPane messages={cleanMessages} side="clean" changes={activeExample?.changes} /> : <div className="clean-placeholder"><div className="placeholder-shield"><Icon name="shield" size={26} /></div><h4>{stage === 'blocked' ? 'A blocked release stays here.' : 'See what will leave.'}</h4><p>Run the privacy export to compare the actual cleaned messages, field by field.</p><span>Roles and message order stay intact.</span></div>}</div><div className="comparison-legend"><span><i className="legend-raw" />Original match</span><span><i className="legend-clean" />Applied replacement</span><span className="legend-note">Highlights use Core’s Unicode character ranges.</span></div></>}

              {tab === 'metadata' && <div className="metadata-panel"><div className="section-intro"><span className="eyebrow">BEYOND THE MESSAGE</span><h3>Clean text is only part of the story.</h3><p>Source IDs, session names, and export details can carry personal data. Review this conversation’s actual field decisions and the shared export details.</p><div className="metadata-context"><span>CONVERSATION {String(selected + 1).padStart(2, '0')}</span><strong>{typeof activeConversation?.metadata?.scenario === 'string' ? activeConversation.metadata.scenario.replaceAll('_', ' ') : `Conversation ${selected + 1}`}</strong><small>{visibleMetadata.length} field decisions</small></div></div>{visibleMetadata.length ? <div className="metadata-table-wrap"><table className="metadata-table"><thead><tr><th>Field</th><th>Source value</th><th>Release action</th><th>Released value</th></tr></thead><tbody>{visibleMetadata.map((item, index) => <tr key={`${item.field}-${index}`}><th scope="row">{item.field}</th><td><code>{textValue(item.before)}</code></td><td><span className={`action-tag action-${item.action.toLowerCase()}`}>{item.action.replaceAll('_', ' ')}</span></td><td><code>{textValue(item.after)}</code></td></tr>)}</tbody></table></div> : <div className="empty-view"><Icon name="layers" size={28} /><h4>Metadata decisions appear after a run.</h4><p>The released files use approved fields. The raw source manifest stays private.</p></div>}</div>}

              {tab === 'receipt' && <div className="receipt-panel"><div className="section-intro"><span className="eyebrow">A RECORD OF THE RELEASE</span><h3>Know what ran. Know what changed.</h3><p>The receipt ties released files to the source version, privacy policy, and actual engine versions. It carries no original match text.</p></div>{run?.receipt ? <><div className="receipt-summary"><div><span>Source version</span><strong>v{run.summary.source_version ?? dataset.source_version}</strong></div><div><span>Policy fingerprint</span><strong className="mono">{String(run.summary.policy_hash || '').slice(0, 12) || 'In receipt'}</strong></div><div><span>Applied replacements</span><strong>{replacements}</strong></div><div><span>Measured processing</span><strong>{typeof run.summary.duration_ms === 'number' ? `${run.summary.duration_ms.toLocaleString(undefined, { maximumFractionDigits: 1 })} ms` : 'In receipt'}</strong></div></div><details className="receipt-json" open><summary><Icon name="code" size={15} />Inspect the full receipt<span>JSON</span></summary><pre>{JSON.stringify(run.receipt, null, 2)}</pre></details><button className="button button-outline" disabled={!validRelease || !!downloading} onClick={() => void download('receipt')}><Icon name="download" size={15} />Download receipt</button></> : <div className="empty-view"><Icon name="file" size={28} /><h4>{stage === 'blocked' ? 'No release. No success receipt.' : 'A receipt is written for a complete release.'}</h4><p>Run the export to inspect the real output, counts, policy, and file hashes.</p></div>}</div>}
            </div>

            {run?.status === 'ready' && <div className="release-summary"><div className="summary-numbers"><div><strong>{run.summary.examples ?? dataset.conversation_count}</strong><span>training examples</span></div><div><strong>{replacements}</strong><span>replacements</span></div><div><strong>{run.summary.examples_changed ?? 0}</strong><span>examples changed</span></div></div><button className="button button-dark" disabled={!validRelease || !!downloading} onClick={() => void download('bundle')}>{downloading === 'bundle' ? <span className="spinner" /> : <Icon name="download" size={16} />}Download release<Icon name="arrow" size={16} /></button></div>}
          </div>

          <aside className="policy-panel"><div className="policy-heading"><span className="eyebrow">YOUR RELEASE RULES</span><h3>Choose what<br />stays private.</h3><p>Redact selected patterns.<br />Keep the useful conversation.</p></div><fieldset disabled={locked}><legend className="visually-hidden">Personal data types to redact</legend><div className="entity-options">{entityOptions.map(option => <label className={`entity-option ${policy.entities.includes(option.id) ? 'checked' : ''}`} key={option.id}><span className="entity-icon"><Icon name={option.icon} size={16} /></span><span><strong>{option.label}</strong><small>{option.example}</small></span><input type="checkbox" checked={policy.entities.includes(option.id)} onChange={() => toggleEntity(option.id)} /><span className="custom-check"><Icon name="check" size={11} /></span></label>)}</div><details className="extra-patterns"><summary>More patterns<span>+</span></summary><p>Dates and ZIP codes may be useful training details. Select them only when needed.</p>{extraOptions.map(option => <label key={option.id}><input type="checkbox" checked={policy.entities.includes(option.id)} onChange={() => toggleEntity(option.id)} />{option.label}</label>)}</details><label className="allow-rule"><span><strong>Keep the public support email</strong><small>Exact exception: support@example.com</small></span><input className="toggle-input" type="checkbox" checked={policy.allow_support_email} onChange={() => updatePolicy({ ...policy, allow_support_email: !policy.allow_support_email })} /><span className="toggle-visual" /></label></fieldset>{policy.entities.length === 0 && <p className="policy-selection-error" role="status">Select at least one pattern to run.</p>}<div className="policy-limit"><Icon name="shield" size={14} /><span>Pattern cleanup is scoped. Names in prose, images, voices, and general secrets are outside this demo’s coverage.</span></div><div className="policy-actions"><button className="button button-sage" disabled={!dataset || locked || policy.entities.length === 0} onClick={() => void runExport()}>{stage === 'running' ? <span className="spinner" /> : <Icon name="shield" size={16} />}{stage === 'running' ? 'Running real cleanup' : stage === 'stale' ? 'Rerun with this policy' : run ? 'Run another export' : 'Run privacy export'}{stage !== 'running' && <Icon name="arrow" size={16} />}</button><button className="failure-button" disabled={!dataset || locked || policy.entities.length === 0} onClick={() => void runExport(true)}><Icon name="alert" size={13} />Test a blocked release</button><p className="failure-help">Intentional error test. See why a failed cleanup never becomes a completed release.</p></div>{validRelease && <div className="secondary-downloads"><button onClick={() => void download('training')} disabled={!!downloading}>Training JSONL<Icon name="download" size={12} /></button><button onClick={() => void download('receipt')} disabled={!!downloading}>Privacy receipt<Icon name="download" size={12} /></button></div>}</aside>
        </div>
      </section>}

      <section className="proof-strip"><div><span className="proof-icon"><Icon name="layers" size={19} /></span><div><strong>Real source, fixed version</strong><p>Each run uses an actual Lance context snapshot.</p></div></div><div><span className="proof-icon"><Icon name="shield" size={19} /></span><div><strong>Review the whole release</strong><p>Message text, metadata rules, and output files.</p></div></div><div><span className="proof-icon"><Icon name="file" size={19} /></span><div><strong>Evidence you can inspect</strong><p>Actual counts, policy versions, and file hashes.</p></div></div></section>
    </main>
    <footer className="site-footer page-width"><span>Built with <b>DataFog Core</b> and <b>lance-context</b>.</span><span>Saved source stays in this browser until removed. The trash clears the app copy, not files in Downloads.</span><a href="https://github.com/DataFog/datafog-lance-context" target="_blank" rel="noreferrer">Open source<Icon name="outward" size={11} /></a></footer>
  </div>;
}
