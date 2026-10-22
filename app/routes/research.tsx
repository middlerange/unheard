import { createFileRoute, Link } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { toast } from 'sonner';
import { AlertCircle, ArrowUpRight, Check, Clock, ExternalLink, Globe, Lightbulb, Loader2, RefreshCw, Rss, Search, Settings, Sparkles, X, Youtube } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/lib/workspace-context';
import type { ResearchFinding, ResearchRun, ResearchSnapshot, ResearchSource } from '@/lib/research-types';

export const Route = createFileRoute('/research')({ component: ResearchPage });

type Tab = 'findings' | 'sources' | 'runs' | 'audience';
type FindingFilter = 'new' | 'saved' | 'dismissed' | 'all';
const panel = 'rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] shadow-panel';
const muted = 'text-[var(--color-text-muted)]';
const selectClass = 'h-10 max-w-full rounded-lg border border-[var(--color-border-opaque)] bg-[var(--color-bg-input)] px-3 text-sm text-[var(--color-text-secondary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]';
const press = 'min-h-10 active:scale-[0.96] transition-[background-color,color,transform]';

function isActive(run: ResearchRun) {
  return run.status === 'queued' || run.status === 'collecting' || run.status === 'ranking';
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const message = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
      ? body.error : `Research request failed (${response.status}). Please try again.`;
    throw new Error(message);
  }
  return response.json();
}

function jsonRequest(method: string, body: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

function message(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

function date(value: number, time = false) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric', ...(time ? { hour: 'numeric', minute: '2-digit' } : {}) }).format(value);
}

function ResearchPage() {
  const { refreshIdeas } = useWorkspace();
  const [data, setData] = useState<ResearchSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('findings');
  const [pending, setPending] = useState<string | null>(null);
  const [filter, setFilter] = useState<FindingFilter>('new');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [sourceQuery, setSourceQuery] = useState('');
  const [sourceCategory, setSourceCategory] = useState('all');
  const [icpDraft, setIcpDraft] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    try {
      const snapshot = await request<ResearchSnapshot>('/api/research', { signal: next.signal });
      if (!next.signal.aborted && alive.current) {
        setData(snapshot);
        setError(null);
      }
    } catch (cause) {
      if (!next.signal.aborted && alive.current) setError(message(cause));
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void refresh();
    return () => { alive.current = false; controller.current?.abort(); };
  }, [refresh]);

  const hasActiveRun = data?.runs.some(isActive) ?? false;
  useEffect(() => {
    if (!hasActiveRun || pending) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      await refresh();
      if (!stopped) timer = setTimeout(poll, 4000);
    }
    timer = setTimeout(poll, 4000);
    return () => { stopped = true; clearTimeout(timer); controller.current?.abort(); };
  }, [hasActiveRun, pending, refresh]);

  async function mutate(key: string, work: () => Promise<void>) {
    if (pending) return;
    controller.current?.abort();
    setPending(key);
    try {
      await work();
      await refresh();
    } catch (cause) {
      if (alive.current) toast.error(message(cause));
    } finally {
      if (alive.current) setPending(null);
    }
  }

  function startRun(mode: 'scan' | 'collect') {
    void mutate(mode, async () => {
      const { run } = await request<{ run: ResearchRun }>('/api/research/runs', jsonRequest('POST', { days: 30, mode }));
      if (alive.current) setData(current => current ? { ...current, runs: [run, ...current.runs.filter(item => item.id !== run.id)] } : current);
      toast.success(mode === 'scan' ? 'Your 30-day scan is queued.' : 'Source collection is queued.');
    });
  }

  function updateDaily(enabled: boolean) {
    void mutate('daily', async () => {
      await request('/api/research', jsonRequest('PATCH', { dailyEnabled: enabled }));
      toast.success(enabled ? 'Daily collection enabled.' : 'Daily collection paused.');
    });
  }

  function updateSource(source: ResearchSource) {
    void mutate(source.id, async () => {
      await request('/api/research/sources', jsonRequest('PATCH', { id: source.id, enabled: !source.enabled }));
    });
  }

  function actOnFinding(finding: ResearchFinding, action: 'save_idea' | 'dismiss') {
    void mutate(finding.id, async () => {
      const result = await request<{ ideaId?: string }>('/api/research/findings', jsonRequest('POST', { id: finding.id, action }));
      if (alive.current) setData(current => current ? { ...current, findings: current.findings.map(item => item.id === finding.id ? { ...item, status: action === 'save_idea' ? 'saved' : 'dismissed', ideaId: result.ideaId ?? item.ideaId } : item) } : current);
      if (action === 'save_idea') {
        toast.success('Finding saved as an idea.');
        try { await refreshIdeas(); } catch { toast.error('Idea saved. Reload Ideas to update the list.'); }
      }
    });
  }

  const findings = useMemo(() => (data?.findings ?? []).filter(finding => {
    const search = query.trim().toLowerCase();
    return (filter === 'all' || finding.status === filter) &&
      (sourceFilter === 'all' || finding.sourceId === sourceFilter) &&
      (!search || [finding.title, finding.summary, finding.sourceName, finding.whyItMatters].some(value => value.toLowerCase().includes(search)));
  }).sort((a, b) => b.score - a.score || b.publishedAt - a.publishedAt), [data?.findings, filter, sourceFilter, query]);
  const sources = useMemo(() => (data?.sources ?? []).filter(source => {
    const search = sourceQuery.trim().toLowerCase();
    return (sourceCategory === 'all' || source.category === sourceCategory) &&
      (!search || [source.name, source.author ?? '', source.notes].some(value => value.toLowerCase().includes(search)));
  }).sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.priority - b.priority || a.name.localeCompare(b.name)), [data?.sources, sourceQuery, sourceCategory]);

  if (!data) return (
    <div className={cn(panel, 'flex min-h-72 flex-col items-center justify-center gap-3 p-8 text-center')}>
      {error ? <><AlertCircle className="size-7 text-amber-400" /><p role="alert" className="max-w-lg text-sm">{error}</p><Button variant="outline" onClick={() => void refresh()} className={press}><RefreshCw />Try again</Button></> : <><Loader2 className={cn('size-6 animate-spin', muted)} /><p className={cn('text-sm', muted)}>Loading your research workspace…</p></>}
    </div>
  );

  const enabledCount = data.sources.filter(source => source.enabled).length;
  const activeRun = data.runs.find(isActive);
  const latestRun = data.runs[0];
  const ready = data.configured && data.workflowConfigured;
  const canRun = ready && enabledCount > 0 && !hasActiveRun && !pending;
  const newCount = data.findings.filter(finding => finding.status === 'new').length;
  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'findings', label: 'Findings', count: newCount },
    { id: 'sources', label: 'Sources', count: enabledCount },
    { id: 'runs', label: 'Run history' },
    { id: 'audience', label: 'Audience' },
  ];

  function navigateTabs(event: KeyboardEvent<HTMLButtonElement>, current: Tab) {
    const index = tabs.findIndex(item => item.id === current);
    const nextIndex = event.key === 'ArrowRight' ? (index + 1) % tabs.length
      : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextTab = tabs[nextIndex].id;
    setTab(nextTab);
    document.getElementById(`research-tab-${nextTab}`)?.focus();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl space-y-2">
          <p className="text-base font-medium text-[var(--color-text-secondary)] [text-wrap:balance]">Find the ideas worth paying attention to.</p>
          <p className={cn('text-sm leading-6 [text-wrap:pretty]', muted)}>Practitioner insights, original research, and product conversations, ranked for your audience. Turn the strongest findings into your next idea.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => startRun('collect')} disabled={!canRun} className={press}><RefreshCw className={pending === 'collect' ? 'animate-spin' : ''} />Collect new items</Button>
          <Button onClick={() => startRun('scan')} disabled={!canRun} className={press}>{pending === 'scan' ? <Loader2 className="animate-spin" /> : <Sparkles />}Run 30-day scan</Button>
        </div>
      </div>

      {ready && enabledCount === 0 && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-4 py-3 text-sm text-[var(--color-text-muted)]"><span>Enable at least one source before starting a scan.</span><Button variant="outline" onClick={() => setTab('sources')} className={press}>Choose sources</Button></div>}
      {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-400/20 bg-amber-400/5 px-4 py-3 text-sm text-amber-200"><span>{error} Showing your last loaded results.</span><Button variant="ghost" onClick={() => void refresh()} className={press}>Retry</Button></div>}
      {!ready && <div className={cn(panel, 'flex items-start gap-3 border-amber-400/20 p-5')}><AlertCircle className="mt-0.5 size-5 shrink-0 text-amber-400" /><div className="space-y-2"><h2 className="text-sm font-medium">Finish research setup</h2><p className={cn('max-w-3xl text-sm leading-6', muted)}>{!data.configured ? 'Add OPENAI_API_KEY to the Cloudflare Worker secrets to enable research ranking. The key stays on the server.' : ''}{!data.configured && !data.workflowConfigured ? ' ' : ''}{!data.workflowConfigured ? 'The research background workflow also needs to be deployed and connected before collection can run.' : ''}</p><Link to="/settings/setup" className="inline-flex min-h-10 items-center gap-1 text-sm text-[var(--color-brand)] hover:underline">Open setup guide<ArrowUpRight className="size-4" /></Link></div></div>}

      <div className={cn(panel, 'flex flex-wrap items-center justify-between gap-5 px-5 py-4')}>
        <div className="flex items-center gap-3"><div className="grid size-10 place-items-center rounded-xl bg-[var(--color-accent)]/10 text-[var(--color-brand)]"><Rss className="size-5" /></div><div><div className="flex items-center gap-2 text-sm font-medium">Daily collection<span className={cn('size-1.5 rounded-full', data.settings.dailyEnabled && ready ? 'bg-emerald-400' : 'bg-[var(--color-text-tertiary)]')} /></div><p className={cn('mt-1 text-xs', muted)}>{data.settings.dailyEnabled ? ready ? 'Checks enabled sources for new items each day.' : 'Enabled · waiting for setup.' : 'Paused. You can still collect items manually.'}</p></div></div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2"><span className={cn('text-xs tabular-nums', muted)}>{enabledCount} sources enabled · {data.model}</span><Toggle label="Enable daily collection" checked={data.settings.dailyEnabled} disabled={Boolean(pending)} onChange={() => updateDaily(!data.settings.dailyEnabled)} /></div>
      </div>

      {activeRun && <div aria-live="polite"><RunCard run={activeRun} active /></div>}
      <div className="flex gap-1 overflow-x-auto border-b border-[var(--color-border)]" role="tablist" aria-label="Research workspace">
        {tabs.map(item => <button key={item.id} type="button" id={`research-tab-${item.id}`} role="tab" tabIndex={tab === item.id ? 0 : -1} onKeyDown={event => navigateTabs(event, item.id)} aria-selected={tab === item.id} aria-controls={`research-panel-${item.id}`} onClick={() => setTab(item.id)} className={cn('relative inline-flex min-h-11 shrink-0 items-center gap-2 px-4 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-accent)]', tab === item.id ? 'text-[var(--color-text)] after:absolute after:inset-x-4 after:bottom-0 after:h-0.5 after:rounded-t after:bg-[var(--color-brand)]' : `${muted} hover:text-[var(--color-text)]`)}>{item.label}{item.count !== undefined && <span className="rounded-md bg-[var(--color-bg-muted)] px-1.5 py-0.5 text-[11px] tabular-nums text-[var(--color-text-muted)]">{item.count}</span>}</button>)}
      </div>

      <section id={`research-panel-${tab}`} role="tabpanel" aria-labelledby={`research-tab-${tab}`} className="space-y-4">
        {tab === 'findings' && <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1" aria-label="Finding status">{(['new', 'saved', 'dismissed', 'all'] as const).map(value => <Button key={value} variant={filter === value ? 'secondary' : 'ghost'} aria-pressed={filter === value} onClick={() => setFilter(value)} className={cn(press, 'capitalize')}>{value === 'new' ? 'To review' : value}</Button>)}</div>
            <div className="flex w-full flex-wrap gap-2 sm:w-auto"><SearchField value={query} onChange={setQuery} placeholder="Search findings" /><select aria-label="Filter findings by source" value={sourceFilter} onChange={event => setSourceFilter(event.target.value)} className={selectClass}><option value="all">All sources</option>{data.sources.map(source => <option key={source.id} value={source.id}>{source.name}</option>)}</select></div>
          </div>
          <div className="flex flex-wrap justify-between gap-2 text-xs text-[var(--color-text-muted)]"><span className="tabular-nums">{findings.length} {findings.length === 1 ? 'finding' : 'findings'} · highest relevance first</span><span>{latestRun?.completedAt ? `Last finished ${date(latestRun.completedAt, true)}` : '30-day lookback · evidence linked to each source'}</span></div>
          {findings.length ? <div className="space-y-4">{findings.map(finding => <FindingCard key={finding.id} finding={finding} disabled={Boolean(pending)} saving={pending === finding.id} onSave={() => actOnFinding(finding, 'save_idea')} onDismiss={() => actOnFinding(finding, 'dismiss')} />)}</div> : <EmptyState icon={Search} title={data.findings.length ? 'No findings match this view' : 'Your next good idea starts here'} description={data.findings.length ? 'Try a different source, search, or review status.' : 'Run a 30-day scan to collect recent items, review the evidence, and rank what matters to your audience.'}>{!data.findings.length && <Button disabled={!canRun} onClick={() => startRun('scan')} className={cn(press, 'mt-5')}><Sparkles />Run 30-day scan</Button>}</EmptyState>}
        </>}

        {tab === 'sources' && <>
          <div className="flex flex-wrap items-start justify-between gap-4"><div className="max-w-2xl"><h2 className="text-sm font-medium">A reading list with a higher bar</h2><p className={cn('mt-2 text-sm leading-6', muted)}>Prioritize people who do the work and publish original thinking. Competitor blogs from the original registry are kept for reference and start disabled. You choose what gets scanned.</p></div><div className="flex flex-wrap gap-2"><SearchField value={sourceQuery} onChange={setSourceQuery} placeholder="Search sources" /><select aria-label="Source category" className={selectClass} value={sourceCategory} onChange={event => setSourceCategory(event.target.value)}><option value="all">All categories</option><option value="practitioner">Practitioners</option><option value="research">Original research</option><option value="youtube">YouTube</option><option value="community">Communities</option><option value="competitor">Competitor blogs</option></select></div></div>
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-4 text-xs leading-6 text-[var(--color-text-muted)]">YouTube videos without an accessible transcript are collected as metadata only and excluded from ranked findings. Sources with access restrictions or collection errors are flagged below.</div>
          {sources.length ? <div className={cn(panel, 'divide-y divide-[var(--color-border)] overflow-hidden')}>{sources.map(source => <SourceRow key={source.id} source={source} disabled={Boolean(pending)} onToggle={() => updateSource(source)} />)}</div> : <EmptyState icon={Globe} title="No sources match" description="Try a different name or category." />}
        </>}

        {tab === 'runs' && <>
          <div><h2 className="text-sm font-medium">Collection and scan history</h2><p className={cn('mt-2 text-sm leading-6', muted)}>Track each run, source coverage, and model usage. Collection gathers new items; a scan ranks findings for your audience.</p></div>
          {data.runs.length ? <div className="space-y-3">{data.runs.map(run => <RunCard key={run.id} run={run} />)}</div> : <EmptyState icon={Clock} title="No research runs yet" description="Your first collection or 30-day scan will appear here, with its progress and token usage." />}
        </>}

        {tab === 'audience' && <form className={cn(panel, 'max-w-3xl p-5 sm:p-6')} onSubmit={event => { event.preventDefault(); void mutate('icp', async () => { await request('/api/research', jsonRequest('PATCH', { icp: (icpDraft ?? data.settings.icp).trim() })); setIcpDraft(null); toast.success('Audience updated. Your next scan will use this context.'); }); }}>
          <div className="flex items-start gap-3"><Settings className="mt-0.5 size-5 text-[var(--color-brand)]" /><div><h2 className="text-base font-medium">What is worth your audience’s time?</h2><p className={cn('mt-2 text-sm leading-6', muted)}>Describe your ideal customer, their responsibilities, and the problems they care about. This guides relevance scoring and suggested content angles.</p></div></div>
          <label htmlFor="research-icp" className="mb-2 mt-6 block text-sm font-medium">Ideal customer profile</label><Textarea id="research-icp" value={icpDraft ?? data.settings.icp} onChange={event => setIcpDraft(event.target.value)} minLength={20} maxLength={4000} required rows={8} className="min-h-48 leading-6" /><p className={cn('mt-2 text-xs tabular-nums', muted)}>{(icpDraft ?? data.settings.icp).length.toLocaleString()} / 4,000 characters · at least 20</p>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-4"><span className={cn('text-xs', muted)}>Existing findings keep their original assessment.</span><Button type="submit" disabled={Boolean(pending) || icpDraft === null || icpDraft.trim().length < 20} className={press}>{pending === 'icp' ? <Loader2 className="animate-spin" /> : <Check />}Save audience</Button></div>
        </form>}
      </section>
    </div>
  );
}

function SearchField({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return <div className="relative w-full sm:w-52"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--color-text-muted)]" /><Input aria-label={placeholder} placeholder={placeholder} value={value} onChange={event => onChange(event.target.value)} className="h-10 pl-9" /></div>;
}

function Toggle({ checked, label, disabled, onChange }: { checked: boolean; label: string; disabled: boolean; onChange: () => void }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={onChange} className="group inline-flex min-h-10 min-w-12 shrink-0 items-center justify-center rounded-lg outline-none disabled:cursor-wait disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"><span className={cn('inline-flex h-6 w-10 items-center rounded-full p-0.5 transition-colors', checked ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-border-opaque)] group-hover:bg-[var(--color-text-tertiary)]')}><span className={cn('size-5 rounded-full bg-white shadow-sm transition-transform motion-reduce:transition-none', checked ? 'translate-x-4' : 'translate-x-0')} /></span></button>;
}

function EmptyState({ icon: Icon, title, description, children }: { icon: typeof Search; title: string; description: string; children?: ReactNode }) {
  return <div className={cn(panel, 'flex min-h-72 flex-col items-center justify-center px-6 py-12 text-center')}><div className="mb-4 grid size-12 place-items-center rounded-2xl bg-[var(--color-bg-muted)]"><Icon className="size-6 text-[var(--color-text-muted)]" /></div><h2 className="text-base font-medium [text-wrap:balance]">{title}</h2><p className={cn('mt-2 max-w-md text-sm leading-6 [text-wrap:pretty]', muted)}>{description}</p>{children}</div>;
}

function FindingCard({ finding, disabled, saving, onSave, onDismiss }: { finding: ResearchFinding; disabled: boolean; saving: boolean; onSave: () => void; onDismiss: () => void }) {
  const saved = finding.status === 'saved';
  return <article className={cn(panel, 'overflow-hidden')}>
    <div className="p-5 sm:p-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div className={cn('flex flex-wrap items-center gap-x-2 gap-y-1 text-xs', muted)}>{finding.contentType === 'video' ? <Youtube className="size-4" /> : <Globe className="size-4" />}<span>{finding.sourceName}</span><span aria-hidden="true">·</span><time dateTime={new Date(finding.publishedAt).toISOString()}>{date(finding.publishedAt)}</time>{finding.contentType === 'video' && <span className={cn('rounded-md px-2 py-1', finding.transcriptStatus === 'available' ? 'bg-emerald-400/10 text-emerald-300' : 'bg-amber-400/10 text-amber-300')}>{finding.transcriptStatus === 'available' ? 'Transcript available' : 'No transcript · limited evidence'}</span>}</div><span className={cn('shrink-0 rounded-md px-2 py-1 text-xs font-medium tabular-nums', finding.score >= 80 ? 'bg-emerald-400/10 text-emerald-300' : 'bg-[var(--color-accent)]/10 text-[var(--color-brand)]')} aria-label={`Relevance score ${finding.score} out of 100`}>{finding.score}/100 relevance</span></div>
      <h2 className="max-w-4xl text-lg font-medium leading-7 tracking-tight [overflow-wrap:anywhere] [text-wrap:balance]"><a href={finding.url} target="_blank" rel="noopener noreferrer" className="hover:text-[var(--color-brand)] transition-colors">{finding.title}<ExternalLink className="ml-2 inline size-4 text-[var(--color-text-muted)]" /><span className="sr-only"> (opens in a new tab)</span></a></h2>
      <p className="mt-3 text-sm leading-6 text-[var(--color-text-secondary)] [text-wrap:pretty]">{finding.summary}</p>
      <div className="mt-5 grid gap-5 lg:grid-cols-2"><div><h3 className="mb-1.5 text-xs font-medium text-[var(--color-text-muted)]">Why your audience cares</h3><p className="text-sm leading-6 text-[var(--color-text-secondary)]">{finding.whyItMatters}</p></div><div className="rounded-xl bg-[var(--color-accent)]/8 p-4 ring-1 ring-inset ring-[var(--color-accent)]/15"><h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-[var(--color-brand)]"><Lightbulb className="size-3.5" />A content angle to explore</h3><p className="text-sm leading-6 text-[var(--color-text-secondary)]">{finding.contentAngle}</p></div></div>
      <details className="group mt-4 rounded-xl bg-[var(--color-bg-input)] px-4"><summary className="min-h-11 cursor-pointer py-3 text-xs font-medium text-[var(--color-text-muted)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]">Evidence and limitations</summary><div className="space-y-3 pb-4 text-sm leading-6"><div><p className="mb-1 text-xs font-medium text-[var(--color-text-muted)]">Evidence from the source</p><p className="text-[var(--color-text-secondary)]">{finding.evidence || 'No supporting excerpt was returned. Review the original before using this finding.'}</p></div><div><p className="mb-1 text-xs font-medium text-[var(--color-text-muted)]">Limitations</p><p className="text-[var(--color-text-secondary)]">{finding.limitations || 'No limitations were reported. Verify claims against the original source.'}</p></div><a href={finding.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center gap-1 text-xs text-[var(--color-brand)] hover:underline">Read original source<ExternalLink className="size-3.5" /></a></div></details>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-5 py-3 sm:px-6"><span className={cn('text-xs', saved ? 'text-emerald-300' : muted)}>{saved ? <span className="inline-flex items-center gap-1.5"><Check className="size-3.5" />Saved to your ideas</span> : finding.status === 'dismissed' ? 'Dismissed' : 'Review the original, then make it your own.'}</span><div className="flex gap-2">{finding.status === 'new' && <Button variant="ghost" disabled={disabled} onClick={onDismiss} className={press}><X />Dismiss</Button>}{saved && finding.ideaId ? <Button asChild variant="outline" className={press}><Link to="/ideas/$id" params={{ id: finding.ideaId }} search={{ assistant: undefined, brandId: undefined, templateId: undefined, instruction: undefined }}>View idea<ArrowUpRight /></Link></Button> : <Button variant="outline" disabled={disabled || saved} onClick={onSave} className={press}>{saving ? <Loader2 className="animate-spin" /> : saved ? <Check /> : <Lightbulb />}{saved ? 'Saved' : 'Save as idea'}</Button>}</div></div>
  </article>;
}

function SourceRow({ source, disabled, onToggle }: { source: ResearchSource; disabled: boolean; onToggle: () => void }) {
  const Icon = source.kind === 'youtube' ? Youtube : source.kind === 'rss' ? Rss : Globe;
  const category = { practitioner: 'Practitioner', research: 'Original research', youtube: 'YouTube', community: 'Community', competitor: 'Competitor blog' }[source.category];
  return <div className={cn('flex items-start gap-3 p-4 sm:gap-4 sm:p-5', !source.enabled && 'bg-[var(--color-bg-subtle)]')}>
    <div className={cn('mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-[var(--color-bg-muted)]', source.enabled ? 'text-[var(--color-brand)]' : muted)}><Icon className="size-4" /></div>
    <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><a href={source.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-7 items-center gap-1.5 text-sm font-medium hover:text-[var(--color-brand)] [overflow-wrap:anywhere]">{source.name}<ExternalLink className="size-3 shrink-0 text-[var(--color-text-muted)]" /></a><span className="rounded-md bg-[var(--color-bg-muted)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)]">{category}</span>{!source.enabled && <span className="text-[10px] text-[var(--color-text-tertiary)]">Disabled</span>}</div>{source.author && <p className={cn('mt-0.5 text-xs', muted)}>{source.author}</p>}<p className={cn('mt-2 max-w-3xl text-xs leading-5 [text-wrap:pretty]', muted)}>{source.notes}</p><div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] tabular-nums text-[var(--color-text-tertiary)]"><span>Priority {source.priority}</span><span>{source.itemCount} collected</span><span>{source.lastCollectedAt ? `Checked ${date(source.lastCollectedAt)}` : 'Not collected yet'}</span></div>{source.lastError && <p className="mt-2 flex items-start gap-1.5 text-xs leading-5 text-amber-300"><AlertCircle className="mt-0.5 size-3.5 shrink-0" />{source.lastError}</p>}</div>
    <Toggle label={`${source.enabled ? 'Disable' : 'Enable'} ${source.name}`} checked={source.enabled} disabled={disabled} onChange={onToggle} />
  </div>;
}

function RunCard({ run, active = false }: { run: ResearchRun; active?: boolean }) {
  const running = isActive(run);
  const stage = { queued: 'Queued', collecting: 'Collecting sources', ranking: 'Ranking findings', completed: 'Completed', failed: 'Failed' }[run.status];
  return <div className={cn(panel, 'p-4 sm:p-5', active && 'border-[var(--color-accent)]/40')}><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><div className={cn('grid size-9 place-items-center rounded-xl', running ? 'bg-[var(--color-accent)]/10 text-[var(--color-brand)]' : run.status === 'failed' ? 'bg-amber-400/10 text-amber-300' : 'bg-[var(--color-bg-muted)] text-[var(--color-text-muted)]')}>{running ? <Loader2 className="size-4 animate-spin" /> : run.status === 'failed' ? <AlertCircle className="size-4" /> : <Check className="size-4" />}</div><div><p className="text-sm font-medium">{run.mode === 'scan' ? `${run.days}-day scan` : 'Source collection'}<span className="mx-2 text-[var(--color-text-tertiary)]">·</span><span className={cn('font-normal', running ? 'text-[var(--color-brand)]' : muted)}>{stage}</span></p><p className={cn('mt-1 text-xs tabular-nums', muted)}>{date(run.createdAt, true)}{run.completedAt ? ` · Finished ${date(run.completedAt, true)}` : ''}</p></div></div><div className="flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums text-[var(--color-text-muted)]"><span>{run.sourceCount} sources</span><span>{run.collectedCount} items</span><span>{run.findingsCount} findings</span></div></div>{running && <p className={cn('mt-3 text-xs leading-5', muted)}>{run.status === 'queued' ? 'The background workflow will start shortly. You can leave this page.' : run.status === 'collecting' ? 'Checking enabled sources and collecting new items. Each source is processed independently.' : 'Reviewing recent items against your audience and extracting source-backed findings.'}</p>}{run.error && <p role="alert" className="mt-3 rounded-lg bg-amber-400/5 p-3 text-xs leading-5 text-amber-300">{run.error}</p>}<div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-[var(--color-border)] pt-3 text-[11px] tabular-nums text-[var(--color-text-tertiary)]"><span>{run.inputTokens.toLocaleString()} input tokens</span><span>{run.outputTokens.toLocaleString()} output tokens</span><span>{run.cacheHits.toLocaleString()} cached items</span><span>API usage billed separately</span></div></div>;
}
