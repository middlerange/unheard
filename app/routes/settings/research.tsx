import { createFileRoute, Link } from '@tanstack/react-router';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { AlertCircle, ArrowUpRight, Check, ChevronLeft, Clock, Loader2, RefreshCw } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { ResearchSnapshot } from '@/lib/research-types';

export const Route = createFileRoute('/settings/research')({ component: ResearchSchedulePage });

const panel = 'rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-5 shadow-panel sm:p-6';
const muted = 'text-[var(--color-text-muted)]';
const press = 'min-h-10 active:scale-[0.96] transition-[background-color,color,transform]';

async function request<T>(init?: RequestInit): Promise<T> {
  const response = await fetch('/api/research', init);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not update research settings. Please try again.');
  return result;
}

function nextRun(settings: ResearchSnapshot['settings']) {
  if (!settings.dailyEnabled) return 'Daily research is paused.';
  if (!settings.nextDailyAt) return 'The next run will be scheduled automatically.';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium', timeStyle: 'short', timeZone: settings.dailyTimezone,
  }).format(settings.nextDailyAt);
}

function ResearchSchedulePage() {
  const [data, setData] = useState<ResearchSnapshot | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [autoDrafts, setAutoDrafts] = useState(true);
  const [time, setTime] = useState('');
  const [timezone, setTimezone] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [timezones, setTimezones] = useState<string[]>([]);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const snapshot = await request<ResearchSnapshot>({ signal });
      if (signal?.aborted) return;
      setData(snapshot);
      setEnabled(snapshot.settings.dailyEnabled);
      setAutoDrafts(snapshot.settings.autoDrafts);
      setTime(snapshot.settings.dailyTime ?? '');
      setTimezone(snapshot.settings.dailyTimezone);
      setError(null);
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : 'Could not load research settings.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setTimezones(Intl.supportedValuesOf('timeZone'));
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const dirty = Boolean(data && (enabled !== data.settings.dailyEnabled || autoDrafts !== data.settings.autoDrafts || time !== (data.settings.dailyTime ?? '') || timezone !== data.settings.dailyTimezone));
  const requiresTime = enabled && (data?.settings.dailyTime !== null || !data?.settings.dailyEnabled);
  const zones = [...new Set(['UTC', timezone, ...timezones])].filter(Boolean).sort();

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !dirty) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await request({ method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dailyEnabled: enabled, autoDrafts, dailyTime: time || null, dailyTimezone: timezone }) });
      const snapshot = await request<ResearchSnapshot>();
      setData(snapshot);
      setEnabled(snapshot.settings.dailyEnabled);
      setAutoDrafts(snapshot.settings.autoDrafts);
      setTime(snapshot.settings.dailyTime ?? '');
      setTimezone(snapshot.settings.dailyTimezone);
      setSaved(true);
      toast.success('Research schedule saved.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the research schedule.');
    } finally {
      setSaving(false);
    }
  }

  return <div className="mx-auto max-w-3xl space-y-6">
    <div className="flex items-start gap-3">
      <Button asChild variant="ghost" size="icon" className={cn(press, 'min-w-10')}><Link to="/settings" aria-label="Back to settings"><ChevronLeft /></Link></Button>
      <div><h1 className="text-xl font-semibold tracking-tight [text-wrap:balance]">Research schedule</h1><p className={cn('mt-2 text-sm leading-6 [text-wrap:pretty]', muted)}>Choose when daily research starts and whether qualified findings become review drafts.</p></div>
    </div>

    {!data && loading && <div role="status" className={cn(panel, 'flex min-h-48 items-center justify-center gap-3 text-sm', muted)}><Loader2 className="size-5 animate-spin" />Loading your schedule…</div>}
    {!data && error && <div role="alert" className={cn(panel, 'space-y-4')}><p className="flex items-center gap-2 text-sm text-amber-300"><AlertCircle className="size-5 shrink-0" />{error}</p><Button variant="outline" onClick={() => void load()} className={press}><RefreshCw />Try again</Button></div>}

    {data && <>
      <form onSubmit={event => void save(event)} className={cn(panel, 'space-y-6')} aria-busy={saving}>
        <label className="flex min-h-10 cursor-pointer items-start gap-3">
          <input type="checkbox" checked={enabled} onChange={event => { setEnabled(event.target.checked); setSaved(false); }} disabled={saving} className="mt-1 size-4 accent-[var(--color-accent)]" />
          <span><span className="block text-sm font-medium">Enable daily research</span><span className={cn('mt-1 block text-sm leading-6', muted)}>Runs on Cloudflare even when your browser and computer are closed.</span></span>
        </label>

        <label className="flex min-h-10 cursor-pointer items-start gap-3">
          <input type="checkbox" checked={autoDrafts} onChange={event => { setAutoDrafts(event.target.checked); setSaved(false); }} disabled={saving} className="mt-1 size-4 accent-[var(--color-accent)]" />
          <span><span className="block text-sm font-medium">Automatically write review drafts</span><span className={cn('mt-1 block text-sm leading-6', muted)}>When off, new scans collect and qualify sources without writing posts or sending new Slack reviews. Scans already started keep their current mode; existing drafts remain available for review.</span></span>
        </label>

        {data.settings.dailyTime === null && <p className="rounded-xl bg-[var(--color-bg-subtle)] p-4 text-sm leading-6 text-[var(--color-text-muted)]">Your current schedule runs on a rolling daily interval. Choose a time and save to switch to a fixed daily schedule.</p>}

        <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <div><label htmlFor="research-daily-time" className="mb-2 block text-sm font-medium">Daily start time</label><Input id="research-daily-time" type="time" value={time} onChange={event => { setTime(event.target.value); setSaved(false); }} required={requiresTime} disabled={saving} className="h-10 tabular-nums" aria-describedby="research-time-help" /><p id="research-time-help" className={cn('mt-2 text-xs leading-5', muted)}>Uses the timezone selected alongside.</p></div>
          <div><label htmlFor="research-daily-timezone" className="mb-2 block text-sm font-medium">Timezone</label><select id="research-daily-timezone" value={timezone} onChange={event => { setTimezone(event.target.value); setSaved(false); }} required disabled={saving} className="h-10 w-full max-w-full rounded-lg border border-[var(--color-border-opaque)] bg-[var(--color-bg-input)] px-3 text-sm text-[var(--color-text-secondary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]">{zones.map(zone => <option key={zone} value={zone}>{zone.replaceAll('_', ' ')}</option>)}</select><button type="button" disabled={saving} onClick={() => { setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone); setSaved(false); }} className={cn(press, 'text-xs text-[var(--color-brand)] hover:underline outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]')}>Use my current timezone</button></div>
        </div>

        <div className="flex items-start gap-3 rounded-xl bg-[var(--color-bg-input)] p-4"><Clock className="mt-0.5 size-5 shrink-0 text-[var(--color-brand)]" /><div><h2 className="text-sm font-medium">Next scheduled run</h2><p className={cn('mt-1 text-sm leading-6 tabular-nums', muted)}>{nextRun(data.settings)}{data.settings.dailyEnabled && <span className="mt-1 block text-xs">{data.settings.dailyTimezone}</span>}</p><p className={cn('mt-2 text-xs leading-5', muted)}>The scheduled time starts the scan. {data.settings.autoDrafts ? 'Drafts arrive after research finishes.' : 'Qualified findings appear on the Research page.'} {dirty ? 'Save your changes to update this schedule.' : 'A scan already in progress finishes before another starts.'}</p></div></div>

        {error && <p role="alert" className="flex items-start gap-2 text-sm leading-6 text-amber-300"><AlertCircle className="mt-0.5 size-5 shrink-0" />{error}</p>}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] pt-5"><p role="status" className={cn('text-xs leading-5', muted)}>{saved && !dirty ? 'Your schedule is saved.' : 'Changes take effect only after you save.'}</p><Button type="submit" disabled={saving || !dirty || (requiresTime && !time)} className={press}>{saving ? <Loader2 className="animate-spin" /> : <Check />}Save schedule</Button></div>
      </form>

      <div className={cn(panel, 'space-y-3')}><h2 className="text-sm font-medium">Choose where your drafts go</h2><p className={cn('text-sm leading-6', muted)}>Enable the profiles you want to write for and connect your Slack approval channel. Publishing requires approval of the latest draft.</p><div className="flex flex-wrap gap-x-6"><Link to="/settings/research-profiles" className="inline-flex min-h-10 items-center gap-1 text-sm text-[var(--color-brand)] hover:underline">Research profiles<ArrowUpRight className="size-4" /></Link><Link to="/settings/slack" className="inline-flex min-h-10 items-center gap-1 text-sm text-[var(--color-brand)] hover:underline">Slack approvals<ArrowUpRight className="size-4" /></Link><Link to="/research" className="inline-flex min-h-10 items-center gap-1 text-sm text-[var(--color-brand)] hover:underline">Run research now<ArrowUpRight className="size-4" /></Link></div></div>
    </>}
  </div>;
}
