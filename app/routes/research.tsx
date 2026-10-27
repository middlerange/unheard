import { RESEARCH_POST_MIN_SCORE, RESEARCH_PRIORITY_SCORE } from "@/lib/research-policy";
import { createFileRoute, Link } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { toast } from 'sonner';
import { AlertCircle, ArrowUpRight, Check, Clock, ExternalLink, Globe, Lightbulb, Loader2, RefreshCw, Rss, Search, Settings, MessageSquare, Send, Sparkles, X, Youtube } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ResearchUsage } from '@/components/research-usage';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/lib/workspace-context';
import type { SlackSettings } from '@/lib/slack-types';
import type { ResearchDraft, ResearchFinding, ResearchRun, ResearchSnapshot, ResearchSource } from '@/lib/research-types';

export const Route = createFileRoute('/research')({ component: ResearchPage });

type Tab = 'drafts' | 'findings' | 'sources' | 'runs' | 'costs' | 'audience';
type FindingFilter = 'new' | 'saved' | 'dismissed' | 'all';
const panel = 'rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] shadow-panel';
const muted = 'text-[var(--color-text-muted)]';
const selectClass = 'h-10 max-w-full rounded-lg border border-[var(--color-border-opaque)] bg-[var(--color-bg-input)] px-3 text-sm text-[var(--color-text-secondary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]';
const press = 'min-h-10 active:scale-[0.96] transition-[background-color,color,transform]';

function isActive(run: ResearchRun) {
  return run.status === 'queued' || run.status === 'collecting' || run.status === 'ranking' || run.status === 'drafting';
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

function date(value: number, time = false, timezone?: string) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric', ...(time ? { hour: 'numeric', minute: '2-digit' } : {}), ...(timezone ? { timeZone: timezone } : {}) }).format(value);
}

function ResearchPage() {
  const { refreshIdeas } = useWorkspace();
  const [data, setData] = useState<ResearchSnapshot | null>(null);
  const [slack, setSlack] = useState<SlackSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('drafts');
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
    void request<SlackSettings>('/api/slack').then(value => { if (alive.current) setSlack(value); }).catch(cause => { if (alive.current) toast.error(`Could not check Slack setup: ${message(cause)}`); });
    return () => { alive.current = false; controller.current?.abort(); };
  }, [refresh]);

  const hasActiveRun = data?.runs.some(isActive) ?? false;
  const hasDraftWork = data?.drafts?.some(draft => ['delivering', 'editing', 'publishing'].includes(draft.status)) ?? false;
  useEffect(() => {
    if ((!hasActiveRun && !hasDraftWork) || pending) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      await refresh();
      if (!stopped) timer = setTimeout(poll, 4000);
    }
    timer = setTimeout(poll, 4000);
    return () => { stopped = true; clearTimeout(timer); controller.current?.abort(); };
  }, [hasActiveRun, hasDraftWork, pending, refresh]);

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

  function startRun(days: 1 | 7 | 30) {
    if (hasActiveRun || pending) return;
    void mutate(`scan-${days}`,  async () => {
      const { run } = await request<{ run: ResearchRun }>('/api/research/runs', jsonRequest('POST', { days, mode: 'scan' }));
      if (alive.current) setData(current => current ? { ...current, runs: [run, ...current.runs.filter(item => item.id !== run.id)] } : current);
      toast.success(days === 1 ? 'Your 24-hour scan and post drafts are queued.' : `Your ${days}-day discovery scan is queued.`);
    });
  }

  function updateDaily(enabled: boolean) {
    void mutate('daily', async () => {
      await request('/api/research', jsonRequest('PATCH', { dailyEnabled: enabled }));
      toast.success(enabled ? 'Daily research enabled.' : 'Daily research paused.');
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
  const draftCount = (data.drafts ?? []).filter(draft => ['draft', 'pending', 'failed'].includes(draft.status)).length;
  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'drafts', label: 'Post drafts', count: draftCount },
    { id: 'findings', label: 'Findings', count: newCount },
    { id: 'sources', label: 'Sources', count: enabledCount },
    { id: 'runs', label: 'Run history' },
    { id: 'costs', label: 'Costs' },
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
    const nextButton = document.getElementById(`research-tab-${nextTab}`);
    nextButton?.focus();
    nextButton?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl space-y-2">
          <p className="text-base font-medium text-[var(--color-text-secondary)] [text-wrap:balance]">Find the ideas worth paying attention to.</p>
          <p className={cn('text-sm leading-6 [text-wrap:pretty]', muted)}>Practitioner insights, original research, and product conversations, ranked for your audience. Each day, review the last 24 hours and turn the best matches into posts for your approval.</p>
        </div>
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => startRun(7)} disabled={!canRun} className={press}>{pending === 'scan-7' ? <Loader2 className="animate-spin" /> : <Search />}7-day discovery</Button>
            <Button variant="outline" onClick={() => startRun(30)} disabled={!canRun} className={press}>{pending === 'scan-30' ? <Loader2 className="animate-spin" /> : <Search />}30-day discovery</Button>
            <Button onClick={() => startRun(1)} disabled={!canRun} className={press} aria-describedby="research-run-now-help">{pending === 'scan-1' ? <Loader2 className="animate-spin" /> : <Sparkles />}Run now</Button>
          </div>
          <p id="research-run-now-help" className={cn('max-w-sm text-xs leading-5', muted)}>{hasActiveRun ? 'A scan is already running. You can close your browser while it finishes.' : 'Scan the last 24 hours and draft strong matches. You can close your browser after starting.'}</p>
        </div>
      </div>

      {ready && enabledCount === 0 && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-4 py-3 text-sm text-[var(--color-text-muted)]"><span>Enable at least one source before starting a scan.</span><Button variant="outline" onClick={() => setTab('sources')} className={press}>Choose sources</Button></div>}
      {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-400/20 bg-amber-400/5 px-4 py-3 text-sm text-amber-200"><span>{error} Showing your last loaded results.</span><Button variant="ghost" onClick={() => void refresh()} className={press}>Retry</Button></div>}
      {!ready && <div className={cn(panel, 'flex items-start gap-3 border-amber-400/20 p-5')}><AlertCircle className="mt-0.5 size-5 shrink-0 text-amber-400" /><div className="space-y-2"><h2 className="text-sm font-medium">Finish research setup</h2><p className={cn('max-w-3xl text-sm leading-6', muted)}>{!data.configured ? 'Add ANTHROPIC_API_KEY to the Cloudflare Worker secrets to enable research ranking. The key stays on the server.' : ''}{!data.configured && !data.workflowConfigured ? ' ' : ''}{!data.workflowConfigured ? 'The research background workflow also needs to be deployed and connected before collection can run.' : ''}</p><Link to="/settings/setup" className="inline-flex min-h-10 items-center gap-1 text-sm text-[var(--color-brand)] hover:underline">Open setup guide<ArrowUpRight className="size-4" /></Link></div></div>}

      <div className={cn(panel, 'flex flex-wrap items-center justify-between gap-5 px-5 py-4')}>
        <div className="flex items-center gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--color-accent)]/10 text-[var(--color-brand)]"><Rss className="size-5" /></div><div><div className="flex items-center gap-2 text-sm font-medium">Daily research<span className={cn('size-1.5 rounded-full', data.settings.dailyEnabled && ready ? 'bg-emerald-400' : 'bg-[var(--color-text-tertiary)]')} /></div><p className={cn('mt-1 text-xs leading-5', muted)}>{data.settings.dailyEnabled ? ready ? 'Reviews fresh and newly discovered source material and drafts every worthwhile match.' : 'Enabled · waiting for setup.' : 'Paused. You can still run a scan manually.'}</p>{data.settings.dailyEnabled && data.settings.nextDailyAt && <p className={cn('mt-1 text-xs leading-5 tabular-nums', muted)}>Next: {date(data.settings.nextDailyAt, true, data.settings.dailyTimezone)} · {data.settings.dailyTimezone}</p>}</div></div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2"><span className={cn('text-xs tabular-nums', muted)}>{enabledCount} sources enabled · {data.model}</span><Link to="/settings/research" className="inline-flex min-h-10 items-center gap-1 text-xs text-[var(--color-brand)] hover:underline">Schedule settings<ArrowUpRight className="size-3.5" /></Link><Toggle label="Enable daily research" checked={data.settings.dailyEnabled} disabled={Boolean(pending)} onChange={() => updateDaily(!data.settings.dailyEnabled)} /></div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-4 py-3"><div className="flex items-start gap-2.5"><MessageSquare className="mt-0.5 size-4 shrink-0 text-[var(--color-brand)]" /><p className={cn('text-xs leading-5', muted)}>{slack?.enabled && slack.configured ? 'Drafts go to Slack for approval. Reply in the thread to request edits, then approve the latest version to publish.' : 'Connect Slack to receive daily drafts, request edits in a thread, and approve publishing. Drafts stay here until connected.'}</p></div><div className="flex flex-wrap gap-x-4"><Link to="/settings/research-profiles" className="inline-flex min-h-10 shrink-0 items-center gap-1 text-xs text-[var(--color-brand)] hover:underline">Research profiles<ArrowUpRight className="size-3.5" /></Link><Link to="/settings/slack" className="inline-flex min-h-10 shrink-0 items-center gap-1 text-xs text-[var(--color-brand)] hover:underline">{slack?.configured ? 'Slack settings' : 'Connect Slack'}<ArrowUpRight className="size-3.5" /></Link></div></div>

      {activeRun && <div aria-live="polite"><RunCard run={activeRun} active /></div>}
      <div className="flex gap-1 overflow-x-auto border-b border-[var(--color-border)]" role="tablist" aria-label="Research workspace">
        {tabs.map(item => <button key={item.id} type="button" id={`research-tab-${item.id}`} role="tab" tabIndex={tab === item.id ? 0 : -1} onKeyDown={event => navigateTabs(event, item.id)} aria-selected={tab === item.id} aria-controls={`research-panel-${item.id}`} onClick={() => setTab(item.id)} className={cn('relative inline-flex min-h-11 shrink-0 items-center gap-2 px-4 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-accent)]', tab === item.id ? 'text-[var(--color-text)] after:absolute after:inset-x-4 after:bottom-0 after:h-0.5 after:rounded-t after:bg-[var(--color-brand)]' : `${muted} hover:text-[var(--color-text)]`)}>{item.label}{item.count !== undefined && <span className="rounded-md bg-[var(--color-bg-muted)] px-1.5 py-0.5 text-[11px] tabular-nums text-[var(--color-text-muted)]">{item.count}</span>}</button>)}
      </div>

      <section id={`research-panel-${tab}`} role="tabpanel" aria-labelledby={`research-tab-${tab}`} className="space-y-4">
        {tab === 'drafts' && <>
          <div><h2 className="text-sm font-medium">Findings worth posting</h2><p className={cn('mt-2 max-w-3xl text-sm leading-6', muted)}>Worthwhile findings scoring at least {RESEARCH_POST_MIN_SCORE}/100 become drafts for your enabled research profiles. Each profile’s instructions guide fit and writing. Every post needs your approval. If nothing clears the bar, there is no post to review.</p></div>
          {(data.drafts ?? []).length ? <div className="space-y-4">{data.drafts.map(draft => <DraftCard key={draft.id} draft={draft} disabled={Boolean(pending) || !slack?.configured || !slack.enabled} retrying={pending === draft.id} onRetry={() => void mutate(draft.id, async () => { await request('/api/slack', jsonRequest('POST', { action: 'retry', draftId: draft.id })); toast.success('Draft queued for Slack review.'); })} />)}</div> : <EmptyState icon={MessageSquare} title="Your next post starts with a useful finding" description={latestRun?.diagnostics?.outcome || "Enable a research profile, then scan the last 24 hours for timely insights. Strong matches become post drafts here and in your Slack approval channel."}><Button disabled={!canRun} onClick={() => startRun(1)} className={cn(press, 'mt-5')}><Sparkles />Scan last 24 hours</Button></EmptyState>}
        </>}

        {tab === 'findings' && <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1" aria-label="Finding status">{(['new', 'saved', 'dismissed', 'all'] as const).map(value => <Button key={value} variant={filter === value ? 'secondary' : 'ghost'} aria-pressed={filter === value} onClick={() => setFilter(value)} className={cn(press, 'capitalize')}>{value === 'new' ? 'To review' : value}</Button>)}</div>
            <div className="flex w-full flex-wrap gap-2 sm:w-auto"><SearchField value={query} onChange={setQuery} placeholder="Search findings" /><select aria-label="Filter findings by source" value={sourceFilter} onChange={event => setSourceFilter(event.target.value)} className={selectClass}><option value="all">All sources</option>{data.sources.map(source => <option key={source.id} value={source.id}>{source.name}</option>)}</select></div>
          </div>
          <div className="flex flex-wrap justify-between gap-2 text-xs text-[var(--color-text-muted)]"><span className="tabular-nums">{findings.length} {findings.length === 1 ? 'finding' : 'findings'} · highest relevance first</span><span>{latestRun?.completedAt ? `Last finished ${date(latestRun.completedAt, true)}` : 'Evidence linked to each source'}</span></div>
          {findings.length ? <div className="space-y-4">{findings.map(finding => <FindingCard key={finding.id} finding={finding} disabled={Boolean(pending)} saving={pending === finding.id} onSave={() => actOnFinding(finding, 'save_idea')} onDismiss={() => actOnFinding(finding, 'dismiss')} />)}</div> : <EmptyState icon={Search} title={data.findings.length ? 'No findings match this view' : 'Your next good idea starts here'} description={data.findings.length ? 'Try a different source, search, or review status.' : 'Run a scan to collect recent items, review the evidence, and rank what matters to your audience.'}>{!data.findings.length && <Button disabled={!canRun} onClick={() => startRun(1)} className={cn(press, 'mt-5')}><Sparkles />Scan last 24 hours</Button>}</EmptyState>}
        </>}

        {tab === 'sources' && <>
          <div className="flex flex-wrap items-start justify-between gap-4"><div className="max-w-2xl"><h2 className="text-sm font-medium">A reading list with a higher bar</h2><p className={cn('mt-2 text-sm leading-6', muted)}>Prioritize people who do the work and publish original thinking. Competitor blogs from the original registry are kept for reference and start disabled. You choose what gets scanned.</p></div><div className="flex flex-wrap gap-2"><SearchField value={sourceQuery} onChange={setSourceQuery} placeholder="Search sources" /><select aria-label="Source category" className={selectClass} value={sourceCategory} onChange={event => setSourceCategory(event.target.value)}><option value="all">All categories</option><option value="practitioner">Practitioners</option><option value="research">Original research</option><option value="industry">Primary industry news</option><option value="youtube">YouTube</option><option value="community">Communities</option><option value="competitor">Competitor blogs</option></select></div></div>
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-4 text-xs leading-6 text-[var(--color-text-muted)]">YouTube videos without an accessible transcript are collected as metadata only and excluded from ranked findings. Sources with access restrictions or collection errors are flagged below.</div>
          {sources.length ? <div className={cn(panel, 'divide-y divide-[var(--color-border)] overflow-hidden')}>{sources.map(source => <SourceRow key={source.id} source={source} disabled={Boolean(pending)} onToggle={() => updateSource(source)} />)}</div> : <EmptyState icon={Globe} title="No sources match" description="Try a different name or category." />}
        </>}

        {tab === 'runs' && <>
          <div><h2 className="text-sm font-medium">Research and draft history</h2><p className={cn('mt-2 text-sm leading-6', muted)}>Track each run, source coverage, and model usage. Daily scans cover the last 24 hours and prepare post drafts. Discovery scans look back 30 days and rank findings.</p></div>
          {data.runs.length ? <div className="space-y-3">{data.runs.map(run => <RunCard key={run.id} run={run} />)}</div> : <EmptyState icon={Clock} title="No research runs yet" description="Your first scan will appear here, with its progress and token usage." />}
        </>}

        {tab === 'costs' && <ResearchUsage timezone={data.settings.dailyTimezone} active={hasActiveRun || hasDraftWork} />}

        {tab === 'audience' && <form className={cn(panel, 'max-w-3xl p-5 sm:p-6')} onSubmit={event => { event.preventDefault(); void mutate('icp', async () => { await request('/api/research', jsonRequest('PATCH', { icp: (icpDraft ?? data.settings.icp).trim() })); setIcpDraft(null); toast.success('Audience updated. Your next scan will use this context.'); }); }}>
          <div className="flex items-start gap-3"><Settings className="mt-0.5 size-5 text-[var(--color-brand)]" /><div><h2 className="text-base font-medium">What is worth your audience’s time?</h2><p className={cn('mt-2 text-sm leading-6', muted)}>Describe your ideal customer, their responsibilities, and the problems they care about. This guides source relevance and suggested content angles. Give each posting profile its own audience and writing instructions in Research profiles.</p></div></div>
          <Link to="/settings/research-profiles" className="mt-3 inline-flex min-h-10 items-center gap-1 text-sm text-[var(--color-brand)] hover:underline">Manage research profiles<ArrowUpRight className="size-4" /></Link>
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
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div className={cn('flex flex-wrap items-center gap-x-2 gap-y-1 text-xs', muted)}>{finding.contentType === 'video' ? <Youtube className="size-4" /> : <Globe className="size-4" />}<span>{finding.sourceName}</span><span aria-hidden="true">·</span><time dateTime={new Date(finding.publishedAt).toISOString()}>{date(finding.publishedAt)}</time>{finding.contentType === 'video' && <span className={cn('rounded-md px-2 py-1', finding.transcriptStatus === 'available' ? 'bg-emerald-400/10 text-emerald-300' : 'bg-amber-400/10 text-amber-300')}>{finding.transcriptStatus === 'available' ? 'Transcript available' : 'No transcript · limited evidence'}</span>}</div><span className={cn('shrink-0 rounded-md px-2 py-1 text-xs font-medium tabular-nums', finding.score >= RESEARCH_PRIORITY_SCORE ? 'bg-emerald-400/10 text-emerald-300' : 'bg-[var(--color-accent)]/10 text-[var(--color-brand)]')} aria-label={`Relevance score ${finding.score} out of 100`}>{finding.score}/100 relevance</span></div>
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
  const category = { practitioner: 'Practitioner', research: 'Original research', industry: 'Primary industry news', youtube: 'YouTube', community: 'Community', competitor: 'Competitor blog' }[source.category];
  return <div className={cn('flex items-start gap-3 p-4 sm:gap-4 sm:p-5', !source.enabled && 'bg-[var(--color-bg-subtle)]')}>
    <div className={cn('mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-[var(--color-bg-muted)]', source.enabled ? 'text-[var(--color-brand)]' : muted)}><Icon className="size-4" /></div>
    <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><a href={source.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-7 items-center gap-1.5 text-sm font-medium hover:text-[var(--color-brand)] [overflow-wrap:anywhere]">{source.name}<ExternalLink className="size-3 shrink-0 text-[var(--color-text-muted)]" /></a><span className="rounded-md bg-[var(--color-bg-muted)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)]">{category}</span>{!source.enabled && <span className="text-[10px] text-[var(--color-text-tertiary)]">Disabled</span>}</div>{source.author && <p className={cn('mt-0.5 text-xs', muted)}>{source.author}</p>}<p className={cn('mt-2 max-w-3xl text-xs leading-5 [text-wrap:pretty]', muted)}>{source.notes}</p><div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] tabular-nums text-[var(--color-text-tertiary)]"><span>Priority {source.priority}</span><span>{source.itemCount} collected</span><span>{source.lastCollectedAt ? `Checked ${date(source.lastCollectedAt)}` : 'Not collected yet'}</span></div>{source.lastError && <p className="mt-2 flex items-start gap-1.5 text-xs leading-5 text-amber-300"><AlertCircle className="mt-0.5 size-3.5 shrink-0" />{source.lastError}</p>}</div>
    <Toggle label={`${source.enabled ? 'Disable' : 'Enable'} ${source.name}`} checked={source.enabled} disabled={disabled} onChange={onToggle} />
  </div>;
}

function RunCard({ run, active = false }: { run: ResearchRun; active?: boolean }) {
  const running = isActive(run);
  const stage = { queued: 'Queued', collecting: 'Collecting sources', ranking: 'Ranking findings', drafting: 'Preparing post drafts', completed: 'Completed', failed: 'Failed' }[run.status];
  const diagnostics = run.diagnostics;
  const rejectedStories = diagnostics?.rejectedStories ?? [];
  return <div className={cn(panel, 'p-4 sm:p-5', active && 'border-[var(--color-accent)]/40')}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3"><div className={cn('grid size-9 place-items-center rounded-xl', running ? 'bg-[var(--color-accent)]/10 text-[var(--color-brand)]' : run.status === 'failed' ? 'bg-amber-400/10 text-amber-300' : 'bg-[var(--color-bg-muted)] text-[var(--color-text-muted)]')}>{running ? <Loader2 className="size-4 animate-spin" /> : run.status === 'failed' ? <AlertCircle className="size-4" /> : <Check className="size-4" />}</div><div><p className="text-sm font-medium">{run.mode === 'test' ? 'Slack review test' : run.mode === 'scan' ? run.days === 1 ? '24-hour scan' : `${run.days}-day discovery` : 'Source collection'}<span className="mx-2 text-[var(--color-text-tertiary)]">·</span><span className={cn('font-normal', running ? 'text-[var(--color-brand)]' : muted)}>{stage}</span></p><p className={cn('mt-1 text-xs tabular-nums', muted)}>{date(run.createdAt, true)}{run.completedAt ? ` · Finished ${date(run.completedAt, true)}` : ''}</p></div></div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums text-[var(--color-text-muted)]"><span>{run.sourceCount} sources</span><span>{run.collectedCount} new items</span><span>{run.findingsCount} findings</span></div>
    </div>
    {running && <p className={cn('mt-3 text-xs leading-5', muted)}>{run.status === 'queued' ? 'The background workflow will start shortly. You can leave this page.' : run.status === 'collecting' ? 'Checking enabled sources and collecting new items. Each source is processed independently.' : run.status === 'drafting' ? 'Writing post drafts from the strongest matches and sending them for review.' : 'Reviewing recent items against your audience and extracting source-backed findings.'}</p>}
    {diagnostics && (diagnostics.screenedCount !== undefined || rejectedStories.length > 0) && <div className="mt-3 space-y-2 rounded-lg bg-[var(--color-bg-subtle)] p-3">
      {diagnostics.screenedCount !== undefined && <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums text-[var(--color-text-secondary)]"><span>{diagnostics.eligibleCount ?? 0} eligible candidates</span>{diagnostics.freshCount !== undefined && <span>{diagnostics.freshCount} recently published</span>}{diagnostics.evergreenCount !== undefined && <span>{diagnostics.evergreenCount} newly discovered older items</span>}<span>{diagnostics.screenedCount} screened</span><span>{diagnostics.evidenceCount ?? 0} stories with public evidence</span>{diagnostics.draftedCount !== undefined && <span>{diagnostics.draftedCount} drafts</span>}</div>}
      {diagnostics.outcome && <p className={cn('text-xs leading-5', muted)}>{diagnostics.outcome}</p>}
      {Boolean(diagnostics.undatedCount || diagnostics.unavailableVideoCount) && <p className="text-[11px] leading-5 text-[var(--color-text-tertiary)]">Excluded: {diagnostics.undatedCount ?? 0} undated items in the source archive · {diagnostics.unavailableVideoCount ?? 0} recent videos without a transcript.</p>}
      {rejectedStories.length > 0 && <details className="border-t border-[var(--color-border)]">
        <summary className="min-h-10 cursor-pointer py-3 text-xs font-medium text-[var(--color-text-secondary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]">Why stories were skipped</summary>
        <ul className="space-y-4 pb-3">{rejectedStories.map((story, index) => <li key={index} className="space-y-1.5">
          <div className="flex flex-col items-start gap-x-3 gap-y-1 sm:flex-row sm:justify-between"><p className="min-w-0 flex-1 text-xs font-medium leading-5 text-[var(--color-text-secondary)] [overflow-wrap:anywhere]">{story.title}</p>{story.score !== null && <span className="shrink-0 rounded-md bg-[var(--color-bg-muted)] px-2 py-1 text-[11px] tabular-nums text-[var(--color-text-muted)]">{story.score}/100 relevance</span>}</div>
          <p className={cn('text-xs leading-5 [overflow-wrap:anywhere]', muted)}>{story.reason}</p>
        </li>)}</ul>
      </details>}
    </div>}
    {run.error && <p role="alert" className="mt-3 rounded-lg bg-amber-400/5 p-3 text-xs leading-5 text-amber-300">{run.error}</p>}
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-[var(--color-border)] pt-3 text-[11px] tabular-nums text-[var(--color-text-tertiary)]"><span>{run.inputTokens.toLocaleString()} input tokens</span><span>{run.outputTokens.toLocaleString()} output tokens</span><span>{run.cacheHits.toLocaleString()} cached items</span><span>API usage billed separately</span></div>
  </div>;
}

function DraftCard({ draft, disabled, retrying, onRetry }: { draft: ResearchDraft; disabled: boolean; retrying: boolean; onRetry: () => void }) {
  const statusLabel: Record<ResearchDraft['status'], string> = {
    draft: 'Ready for review', delivering: 'Sending to Slack', pending: 'Awaiting approval', editing: 'Applying thread edits',
    approved_test: 'Test approved', approved: 'Approved', rejected: 'Rejected', publishing: 'Publishing', published: 'Published', failed: 'Needs attention',
  };
  const busy = ['delivering', 'editing', 'publishing'].includes(draft.status);
  const guidance: Record<ResearchDraft['status'], string> = {
    draft: 'Send this draft to Slack for review when your connection is ready.',
    delivering: 'Sending the latest revision to your approval channel.',
    pending: 'Reply in the Slack thread to request changes. Approve the latest version when it is ready.',
    editing: 'A new revision is being prepared. Review the updated version before approving.',
    approved_test: 'Test complete. The latest revision was approved; nothing was published.',
    approved: 'The latest version has been approved in Slack.',
    rejected: 'This draft was rejected in Slack.',
    publishing: 'Publishing the approved version to its connected profiles.',
    published: 'Published after approval in Slack.',
    failed: 'Check the error and review history before retrying.',
  };
  return <article className={cn(panel, 'overflow-hidden')}>
    <div className="space-y-4 p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2"><span className={cn('rounded-md px-2 py-1 text-xs font-medium', draft.status === 'published' || draft.status === 'approved' || draft.status === 'approved_test' ? 'bg-emerald-400/10 text-emerald-300' : draft.status === 'failed' ? 'bg-amber-400/10 text-amber-300' : 'bg-[var(--color-accent)]/10 text-[var(--color-brand)]')}>{busy && <Loader2 className="mr-1.5 inline size-3 animate-spin" />}{statusLabel[draft.status]}</span><span className={cn('text-xs tabular-nums', muted)}>Version {draft.revision} · Updated {date(draft.updatedAt, true)}</span></div>
      <h2 className="text-lg font-medium leading-7 tracking-tight [overflow-wrap:anywhere] [text-wrap:balance]">{draft.title}</h2>
      <p className={cn('text-sm leading-6', muted)}>{draft.whyItMatters}</p>
      <div className="grid gap-3 lg:grid-cols-2">{draft.content.targets.map((target, index) => <div key={`${target.channelId}-${index}`} className="min-w-0 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-input)] p-4"><div className="mb-3"><h3 className="text-sm font-medium text-[var(--color-text)]">{target.channelName || (target.platform === 'twitter' ? 'X' : target.platform)}</h3><p className={cn('mt-1 text-xs capitalize', muted)}>{target.platform === 'twitter' ? 'X' : target.platform}{target.subreddit ? ` · r/${target.subreddit}` : ''}</p></div>{target.redditTitle && <h4 className="mb-3 text-sm font-medium leading-6 [overflow-wrap:anywhere]">{target.redditTitle}</h4>}<p className="whitespace-pre-wrap text-sm leading-6 text-[var(--color-text-secondary)] [overflow-wrap:anywhere]">{target.content}</p>{target.thread?.length > 0 && <div className="mt-4 space-y-3 border-t border-[var(--color-border)] pt-4">{target.thread.map((part, partIndex) => <div key={partIndex}><span className={cn('mb-1 block text-[11px] tabular-nums', muted)}>Thread {partIndex + 2}</span><p className="whitespace-pre-wrap text-sm leading-6 text-[var(--color-text-secondary)] [overflow-wrap:anywhere]">{part}</p></div>)}</div>}</div>)}</div>
      {draft.error && <p role="alert" className="flex items-start gap-2 rounded-lg bg-amber-400/5 p-3 text-xs leading-5 text-amber-300"><AlertCircle className="mt-0.5 size-4 shrink-0" />{draft.error}</p>}
      <a href={draft.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center gap-1 text-xs text-[var(--color-brand)] hover:underline">Read source<ExternalLink className="size-3.5" /></a>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-5 py-3 sm:px-6"><p className={cn('max-w-lg text-xs leading-5', muted)}>{guidance[draft.status]}</p><div className="flex flex-wrap gap-2">{draft.postId && !draft.isTest && <Button asChild variant="outline" className={press}><Link to="/posts/$id" params={{ id: draft.postId }}>View post<ArrowUpRight /></Link></Button>}{draft.slackThreadUrl && <Button asChild variant="outline" className={press}><a href={draft.slackThreadUrl} target="_blank" rel="noopener noreferrer"><MessageSquare />Open Slack thread<ArrowUpRight /></a></Button>}{['draft', 'failed'].includes(draft.status) && <Button variant="outline" className={press} disabled={disabled} onClick={onRetry}>{retrying ? <Loader2 className="animate-spin" /> : <Send />}{draft.status === 'failed' ? 'Retry Slack review' : 'Send for review'}</Button>}</div></div>
  </article>;
}
