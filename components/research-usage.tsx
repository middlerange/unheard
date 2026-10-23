import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, ExternalLink, Loader2, RefreshCw } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ResearchRunUsage, ResearchUsageStage, ResearchUsageSummary, ResearchUsageTotals } from '@/lib/research-usage-types';

const panel = 'rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] shadow-panel';
const muted = 'text-[var(--color-text-muted)]';
const press = 'min-h-10 active:scale-[0.96] transition-[background-color,color,transform]';
const stageLabels: Record<ResearchUsageStage, string> = {
  research: 'Research and ranking', draft_generation: 'Draft generation', slack_revision: 'Slack edits', legacy: 'Historical usage',
};
type Period = 'today' | 'month' | 'allTime';

function money(value: number) {
  if (value > 0 && value < 0.000001) return '<$0.000001';
  let maximumFractionDigits = 2;
  if (value > 0 && value < 0.01) maximumFractionDigits = 6;
  else if (value < 1) maximumFractionDigits = 4;
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits }).format(value);
}

function cost(totals: ResearchUsageTotals) {
  if (totals.unknownRequests > 0 && totals.requestCount === totals.unknownRequests) return 'Unavailable';
  return `${money(totals.costUsd)}${totals.unknownRequests > 0 ? '+' : ''}`;
}

function count(value: number) { return value.toLocaleString(); }
function counted(value: number, noun: string) { return `${count(value)} ${noun}${value === 1 ? '' : 's'}`; }

function runLabel(run: ResearchRunUsage) {
  if (run.mode === 'test') return 'Slack review test';
  if (run.mode === 'collect') return 'Source collection';
  return run.days === 1 ? '24-hour scan' : `${run.days}-day discovery`;
}

export function ResearchUsage({ timezone: initialTimezone, active = false }: { timezone: string; active?: boolean }) {
  const [timezone, setTimezone] = useState(initialTimezone);
  const [timezones, setTimezones] = useState<string[]>([]);
  const [data, setData] = useState<ResearchUsageSummary | null>(null);
  const [period, setPeriod] = useState<Period>('month');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  const load = useCallback(async (signal: AbortSignal) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/research/usage?timezone=${encodeURIComponent(timezone)}`, { signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not load research costs.');
      if (!signal.aborted) { setData(result); setError(null); }
    } catch (cause) {
      if (!signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load research costs.');
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [timezone]);

  useEffect(() => { setTimezones(Intl.supportedValuesOf('timeZone')); }, []);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, revision, active]);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setRevision(value => value + 1), 10000);
    return () => clearInterval(timer);
  }, [active]);

  const zones = [...new Set(['UTC', timezone, ...timezones])].sort();
  const periods: { id: Period; label: string }[] = [{ id: 'today', label: 'Today' }, { id: 'month', label: 'This month' }, { id: 'allTime', label: 'All time' }];

  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="max-w-2xl"><h2 className="text-sm font-medium">What research costs</h2><p className={cn('mt-2 text-sm leading-6 [text-wrap:pretty]', muted)}>Estimated model costs for research, post drafts, and Slack edits, in USD. Cloudflare, hosting, and other services are excluded.</p></div>
      <div className="flex w-full flex-wrap items-end gap-2 sm:w-auto"><div className="min-w-0 flex-1 sm:flex-none"><label htmlFor="research-cost-timezone" className={cn('mb-1.5 block text-xs', muted)}>Reporting timezone</label><select id="research-cost-timezone" value={timezone} onChange={event => { setTimezone(event.target.value); setData(null); setError(null); }} className="h-10 w-full max-w-64 rounded-lg border border-[var(--color-border-opaque)] bg-[var(--color-bg-input)] px-3 text-sm text-[var(--color-text-secondary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]">{zones.map(zone => <option key={zone} value={zone}>{zone.replaceAll('_', ' ')}</option>)}</select></div><Button variant="outline" disabled={loading} onClick={() => setRevision(value => value + 1)} className={press}>{loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}Refresh</Button></div>
    </div>

    {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-400/20 bg-amber-400/5 p-4 text-sm text-amber-300"><span className="inline-flex items-center gap-2"><AlertCircle className="size-5 shrink-0" />{error}{data ? ' Showing the last loaded costs.' : ''}</span><Button variant="outline" disabled={loading} onClick={() => setRevision(value => value + 1)} className={press}>Try again</Button></div>}
    {!data && loading && <div role="status" className={cn(panel, 'flex min-h-56 items-center justify-center gap-3 p-6 text-sm', muted)}><Loader2 className="size-5 animate-spin" />Loading research costs…</div>}

    {data && <>
      <div className="grid gap-4 sm:grid-cols-3">{periods.map(item => <div key={item.id} className={cn(panel, 'min-w-0 p-5')}><h3 className={cn('text-sm', muted)}>{item.label}</h3><p className="mt-3 text-2xl font-semibold tracking-tight tabular-nums [overflow-wrap:anywhere]">{cost(data[item.id])}</p><p className={cn('mt-2 text-xs leading-5 tabular-nums', muted)}>{counted(data[item.id].requestCount, 'usage record')} · {count(data[item.id].inputTokens + data[item.id].outputTokens)} tokens</p>{data[item.id].unknownRequests > 0 && <p className="mt-2 text-xs leading-5 text-amber-300">{counted(data[item.id].unknownRequests, 'request')} pending or unpriced; costs are excluded.</p>}</div>)}</div>

      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-4 text-xs leading-6 text-[var(--color-text-muted)]"><p>{data.historyNote}</p><p>These are estimates, not an invoice. Rates dated {data.pricingAsOf}. {data.trackingStartedAt ? `Detailed tracking began ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: data.timezone }).format(data.trackingStartedAt)}.` : 'No detailed requests have been recorded yet.'} <a href={data.pricingUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center gap-1 text-[var(--color-brand)] hover:underline">Model pricing<ExternalLink className="size-3.5" /></a></p></div>

      <div className={cn(panel, 'overflow-hidden')}>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"><h3 className="text-sm font-medium">Cost by stage</h3><div className="flex flex-wrap gap-1" aria-label="Stage breakdown period">{periods.map(item => <Button key={item.id} variant={period === item.id ? 'secondary' : 'ghost'} aria-pressed={period === item.id} onClick={() => setPeriod(item.id)} className={press}>{item.label}</Button>)}</div></div>
        <div className="overflow-x-auto outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-accent)]" tabIndex={0} role="region" aria-label="Scrollable stage cost breakdown"><table className="w-full text-left text-xs"><caption className="sr-only">Estimated cost by stage for {periods.find(item => item.id === period)?.label.toLowerCase()}</caption><thead className="border-y border-[var(--color-border)] bg-[var(--color-bg-subtle)] text-[var(--color-text-muted)]"><tr><th scope="col" className="px-5 py-3 font-medium">Stage</th><th scope="col" className="px-4 py-3 text-right font-medium">Input tokens</th><th scope="col" className="px-4 py-3 text-right font-medium">Output tokens</th><th scope="col" className="px-4 py-3 text-right font-medium">Cached input</th><th scope="col" className="px-4 py-3 text-right font-medium">Cache writes</th><th scope="col" className="px-5 py-3 text-right font-medium">Known estimate</th></tr></thead><tbody className="divide-y divide-[var(--color-border)]">{data.stages[period].map(stage => <tr key={stage.stage}><th scope="row" className="px-5 py-4 font-normal"><span className="whitespace-nowrap text-[var(--color-text-secondary)]">{stageLabels[stage.stage]}</span><span className={cn('mt-1 block tabular-nums', muted)}>{counted(stage.requestCount, stage.stage === 'legacy' ? 'historical run' : 'request')}{stage.unknownRequests > 0 ? ` · ${count(stage.unknownRequests)} pending or unpriced` : ''}</span></th><td className="px-4 py-4 text-right tabular-nums">{count(stage.inputTokens)}</td><td className="px-4 py-4 text-right tabular-nums">{count(stage.outputTokens)}</td><td className="px-4 py-4 text-right tabular-nums">{stage.stage === 'legacy' ? '—' : count(stage.cachedInputTokens)}</td><td className="px-4 py-4 text-right tabular-nums">{stage.stage === 'legacy' ? '—' : count(stage.cacheWriteTokens)}</td><td className="whitespace-nowrap px-5 py-4 text-right tabular-nums">{cost(stage)}</td></tr>)}{data.stages[period].length === 0 && <tr><td colSpan={6} className={cn('px-5 py-10 text-center', muted)}>No model usage recorded for this period.</td></tr>}</tbody></table></div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2"><TotalsTable title="Daily totals" label="Day" rows={data.daily.map(row => ({ ...row, label: row.date }))} /><TotalsTable title="Monthly totals" label="Month" rows={data.monthly.map(row => ({ ...row, label: row.month }))} /></div>

      <div className="space-y-3"><div><h3 className="text-sm font-medium">Recent runs</h3><p className={cn('mt-2 text-xs leading-5', muted)}>Up to 50 recent runs. Expand a run to see how research, drafting, and Slack edits contributed.</p></div>{data.runs.length ? <div className={cn(panel, 'divide-y divide-[var(--color-border)] overflow-hidden')}>{data.runs.map(run => <details key={run.runId} className="group"><summary className="flex min-h-16 cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-5 py-4 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-accent)] [&::-webkit-details-marker]:hidden"><div><span className="text-sm font-medium">{runLabel(run)}</span><span className={cn('ml-2 text-xs capitalize', muted)}>{run.status}</span><p className={cn('mt-1 text-xs tabular-nums', muted)}>{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: data.timezone }).format(run.createdAt)}</p></div><div className="flex items-center gap-4"><span className={cn('text-xs tabular-nums', muted)}>{counted(run.requestCount, 'usage record')}</span><span className="text-sm tabular-nums">{cost(run)}</span><span className="text-lg text-[var(--color-text-muted)] group-open:hidden" aria-hidden="true">+</span><span className="hidden text-lg text-[var(--color-text-muted)] group-open:inline" aria-hidden="true">−</span></div></summary><div className="space-y-3 border-t border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-5 py-4">{run.stages.map(stage => <div key={stage.stage} className="flex flex-wrap items-center justify-between gap-2 text-xs"><span className={muted}>{stageLabels[stage.stage]} · {count(stage.inputTokens)} in / {count(stage.outputTokens)} out</span><span className="tabular-nums">{cost(stage)}</span></div>)}{run.unknownRequests > 0 && <p className="text-xs leading-5 text-amber-300">{counted(run.unknownRequests, 'request')} pending or unpriced. Costs are excluded.</p>}<p className={cn('text-[11px] tabular-nums [overflow-wrap:anywhere]', muted)}>Run {run.runId}</p></div></details>)}</div> : <div className={cn(panel, 'p-8 text-center text-sm', muted)}>Your first research run and its estimated costs will appear here.</div>}</div>
    </>}
  </div>;
}

function TotalsTable({ title, label, rows }: { title: string; label: string; rows: (ResearchUsageTotals & { label: string })[] }) {
  return <div className={cn(panel, 'min-w-0 overflow-hidden')}><h3 className="px-5 py-4 text-sm font-medium">{title}</h3><div className="max-h-80 overflow-auto"><table className="w-full text-left text-xs"><caption className="sr-only">{title} in the selected reporting timezone</caption><thead className="sticky top-0 z-10 border-y border-[var(--color-border)] bg-[var(--color-bg-elevated)] text-[var(--color-text-muted)]"><tr><th scope="col" className="px-5 py-3 font-medium">{label}</th><th scope="col" className="px-4 py-3 text-right font-medium">Tokens</th><th scope="col" className="px-5 py-3 text-right font-medium">Known estimate</th></tr></thead><tbody className="divide-y divide-[var(--color-border)]">{rows.map(row => <tr key={row.label}><th scope="row" className="whitespace-nowrap px-5 py-3 font-normal tabular-nums">{row.label}</th><td className="px-4 py-3 text-right tabular-nums">{count(row.inputTokens + row.outputTokens)}</td><td className="whitespace-nowrap px-5 py-3 text-right tabular-nums">{cost(row)}{row.unknownRequests > 0 && <span className="mt-1 block text-[10px] text-amber-300">{count(row.unknownRequests)} pending or unpriced</span>}</td></tr>)}{rows.length === 0 && <tr><td colSpan={3} className={cn('px-5 py-10 text-center', muted)}>No model usage recorded yet.</td></tr>}</tbody></table></div></div>;
}
