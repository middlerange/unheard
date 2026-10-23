import { createFileRoute, Link } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { toast } from 'sonner';
import { AlertCircle, ArrowDownToLine, ArrowUpRight, Check, ChevronLeft, Copy, ExternalLink, Loader2, MessageSquare, RefreshCw, Search, Send, ShieldCheck } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { SlackOptions, SlackSettings } from '@/lib/slack-types';

type SlackOutcome = 'connected' | 'denied' | 'error';
export const Route = createFileRoute('/settings/slack')({
  validateSearch: (search: Record<string, unknown>): { slack?: SlackOutcome } => {
    const value = search.slack;
    return value === 'connected' || value === 'denied' || value === 'error' ? { slack: value } : {};
  },
  component: SlackSettingsPage,
});

const panel = 'rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-5 shadow-panel sm:p-6';
const muted = 'text-[var(--color-text-muted)]';
const press = 'min-h-10 active:scale-[0.96] transition-[background-color,color,transform]';
const selectClass = 'h-11 w-full rounded-lg border border-[var(--color-border-opaque)] bg-[var(--color-bg-input)] px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] disabled:opacity-50';

async function slackRequest<T>(method = 'GET', body?: unknown, path = '/api/slack'): Promise<T> {
  const response = await fetch(path, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Slack could not be reached. Please try again.');
  return result;
}

function SlackSettingsPage() {
  const { slack: outcome } = Route.useSearch();
  const [settings, setSettings] = useState<SlackSettings | null>(null);
  const [options, setOptions] = useState<SlackOptions | null>(null);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<'save' | 'test' | null>(null);
  const [channelId, setChannelId] = useState('');
  const [reviewerIds, setReviewerIds] = useState<string[]>([]);
  const [reviewerQuery, setReviewerQuery] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [administratorOpen, setAdministratorOpen] = useState(false);
  const [botToken, setBotToken] = useState('');
  const [signingSecret, setSigningSecret] = useState('');
  const [manualChannelId, setManualChannelId] = useState('');
  const [manualReviewers, setManualReviewers] = useState('');
  const [origin, setOrigin] = useState('');
  const [testResult, setTestResult] = useState<string | null>(null);
  const alive = useRef(true);

  const applySettings = useCallback((value: SlackSettings) => {
    setSettings(value);
    setChannelId(value.channelId || '');
    setReviewerIds(value.approverUserIds);
    setManualChannelId(value.channelId || '');
    setManualReviewers(value.approverUserIds.join(', '));
    setEnabled(value.enabled);
  }, []);

  useEffect(() => {
    alive.current = true;
    setOrigin(window.location.origin);
    let cancelled = false;
    slackRequest<SlackSettings>().then(value => {
      if (!cancelled) { applySettings(value); setError(null); }
    }).catch(cause => { if (!cancelled) setError(errorMessage(cause)); });
    return () => { cancelled = true; alive.current = false; };
  }, [applySettings, loadVersion]);

  const loadOptions = useCallback(async () => {
    setOptionsLoading(true);
    setOptionsError(null);
    try {
      const value = await slackRequest<SlackOptions>('GET', undefined, '/api/slack/options');
      if (alive.current) setOptions(value);
    } catch (cause) { if (alive.current) setOptionsError(errorMessage(cause)); }
    finally { if (alive.current) setOptionsLoading(false); }
  }, []);

  useEffect(() => {
    if (settings?.configured) void loadOptions();
  }, [settings?.configured, loadOptions]);

  const dirty = Boolean(settings && (channelId !== (settings.channelId || '') || [...reviewerIds].sort().join(',') !== [...settings.approverUserIds].sort().join(',') || enabled !== settings.enabled));
  const selectedChannel = options?.channels.find(channel => channel.id === channelId);
  const availableReviewers = options?.reviewers ?? [];
  const shownReviewers = availableReviewers.filter(reviewer => reviewer.name.toLowerCase().includes(reviewerQuery.trim().toLowerCase()));
  const missingReviewers = options ? reviewerIds.filter(id => !availableReviewers.some(reviewer => reviewer.id === id)) : [];
  const manualReviewerIds = manualReviewers.split(/[\s,]+/).filter(Boolean);
  const invalidManualReviewers = manualReviewerIds.some(id => !/^[UW][A-Z0-9]{8,}$/.test(id));
  const manualCredentialsReady = Boolean((botToken.trim() || settings?.hasBotToken) && (signingSecret.trim() || settings?.hasSigningSecret));

  async function save(event: FormEvent, manual = false) {
    event.preventDefault();
    setPending('save');
    setError(null);
    setTestResult(null);
    try {
      const body = manual
        ? { channelId: manualChannelId.trim(), approverUserIds: manualReviewerIds, enabled, ...(botToken.trim() ? { botToken: botToken.trim() } : {}), ...(signingSecret.trim() ? { signingSecret: signingSecret.trim() } : {}) }
        : { channelId, approverUserIds: reviewerIds, enabled };
      const value = await slackRequest<SlackSettings>('PATCH', body);
      if (!alive.current) return;
      applySettings(value);
      setBotToken('');
      setSigningSecret('');
      toast.success('Slack approval settings saved.');
      if (manual && settings?.configured) void loadOptions();
    } catch (cause) { if (alive.current) setError(errorMessage(cause)); }
    finally { if (alive.current) setPending(null); }
  }

  async function test() {
    setPending('test');
    setError(null);
    setTestResult(null);
    try {
      const result = await slackRequest<{ channelName: string }>('POST', { action: 'test' });
      if (alive.current) setTestResult(`Test sent to #${result.channelName}. Check Slack to confirm it arrived.`);
    } catch (cause) { if (alive.current) setError(errorMessage(cause)); }
    finally { if (alive.current) setPending(null); }
  }

  function toggleReviewer(id: string) {
    setReviewerIds(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
  }

  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); toast.success('Copied.'); }
    catch { toast.error('Could not copy. Select the address and copy it manually.'); }
  }

  return <div className="mx-auto max-w-5xl space-y-6">
    <div className="flex items-start gap-3">
      <Button asChild variant="ghost" size="icon" className={press}><Link to="/settings" aria-label="Back to settings"><ChevronLeft /></Link></Button>
      <div className="min-w-0"><h1 className="text-xl font-semibold tracking-tight">Slack approvals</h1><p className={cn('mt-2 max-w-2xl text-sm leading-6', muted)}>Review daily post drafts in Slack. Reply in the thread to request edits, then approve the version you want to publish.</p></div>
    </div>
    {outcome === 'connected' && <Notice success>Workspace connected. Choose your approval channel and reviewers below.</Notice>}
    {outcome === 'denied' && <Notice>The Slack connection was cancelled. You can connect again when you are ready.</Notice>}
    {outcome === 'error' && <Notice>Slack could not be connected. Try again, or ask your app administrator to check the connection setup.</Notice>}
    {error && <Notice><span>{error}</span>{!settings && <Button type="button" variant="outline" className={cn(press, 'ml-3')} onClick={() => setLoadVersion(value => value + 1)}>Try again</Button>}</Notice>}

    <div className="grid items-start gap-6 lg:grid-cols-[1.1fr_1fr]">
      <div className="space-y-5">
        <section className={cn(panel, 'space-y-4')}>
          <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="inline-flex items-center gap-2 text-base font-medium"><MessageSquare className="size-5 text-[var(--color-brand)]" />Slack workspace</h2><span className={cn('rounded-md px-2 py-1 text-xs', settings?.configured ? 'bg-emerald-400/10 text-emerald-300' : 'bg-[var(--color-bg-muted)] text-[var(--color-text-muted)]')}>{settings ? settings.configured ? 'Connected' : 'Not connected' : 'Loading…'}</span></div>
          {!settings && !error && <p className={cn('flex items-center gap-2 text-sm', muted)}><Loader2 className="size-4 animate-spin" />Checking your connection…</p>}
          {settings?.configured && <p className={cn('text-sm leading-6', muted)}>Your workspace is connected. Choose where drafts appear and who can edit or approve them.</p>}
          {settings && !settings.configured && <p className={cn('text-sm leading-6', muted)}>Connect your workspace, then choose a channel and the people who review posts.</p>}
          {settings?.oauthAvailable && <Button asChild variant={settings.configured ? 'outline' : 'default'} className={press}><a href="/api/slack/connect"><MessageSquare />{settings.configured ? 'Reconnect Slack' : 'Connect to Slack'}<ArrowUpRight /></a></Button>}
          {settings && !settings.oauthAvailable && <Button disabled className={press}><MessageSquare />{settings.configured ? 'Reconnect Slack' : 'Connect to Slack'}</Button>}
          {settings && !settings.oauthAvailable && <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-4"><p className="text-sm font-medium text-amber-300">Workspace connection needs one-time setup by your app administrator.</p><p className={cn('mt-2 text-xs leading-5', muted)}>Once the app is configured, you can connect your workspace here.</p><Button type="button" variant="ghost" className={cn(press, 'mt-2 px-0 text-[var(--color-brand)]')} onClick={() => { setAdministratorOpen(true); document.getElementById('slack-administrator-setup')?.scrollIntoView({ block: 'start' }); }}>Administrator setup<ArrowUpRight /></Button></div>}
        </section>

        {settings?.configured && <form onSubmit={event => void save(event)} className={cn(panel, 'space-y-5')}>
          <div><h2 className="text-base font-medium">Where should drafts go?</h2><p className={cn('mt-2 text-sm leading-6', muted)}>Choose one approval channel. Posts publish only after a selected reviewer approves the latest draft.</p></div>
          <div><label htmlFor="slack-channel" className="mb-2 block text-sm font-medium">Approval channel</label><select id="slack-channel" value={channelId} onChange={event => setChannelId(event.target.value)} required disabled={!options || optionsLoading || Boolean(pending)} className={selectClass}><option value="">Choose a channel</option>{channelId && !selectedChannel && <option value={channelId}>Previously selected channel · refresh to check access</option>}{options?.channels.map(channel => <option key={channel.id} value={channel.id}>#{channel.name}{channel.isPrivate ? ' · Private' : ''}</option>)}</select><p className={cn('mt-2 text-xs leading-5', muted)}>For a private channel, invite Content Hub to it in Slack, then refresh this list. The app joins your chosen public channel when you save.</p></div>
          <fieldset disabled={optionsLoading || Boolean(pending)}><legend className="mb-2 text-sm font-medium">Reviewers</legend><p className={cn('mb-3 text-xs leading-5', muted)}>These people can request edits, approve, or reject drafts.</p><div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--color-text-muted)]" /><Input aria-label="Find a reviewer" placeholder="Find a reviewer" value={reviewerQuery} onChange={event => setReviewerQuery(event.target.value)} disabled={!options} className="h-10 pl-9" /></div><div className="mt-2 max-h-56 overflow-y-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-input)]">{optionsLoading && !options ? <p className={cn('p-4 text-sm', muted)}>Loading people from Slack…</p> : shownReviewers.length ? shownReviewers.map(reviewer => <label key={reviewer.id} className="flex min-h-11 cursor-pointer items-center gap-3 px-4 py-2.5 text-sm hover:bg-[var(--color-bg-muted)]"><input type="checkbox" checked={reviewerIds.includes(reviewer.id)} disabled={!reviewerIds.includes(reviewer.id) && reviewerIds.length >= 20} onChange={() => toggleReviewer(reviewer.id)} className="size-4 shrink-0 accent-[var(--color-accent)]" /><span className="min-w-0 [overflow-wrap:anywhere]">{reviewer.name}</span></label>) : <p className={cn('p-4 text-sm', muted)}>{options ? reviewerQuery ? 'No people match this search.' : 'No reviewers are available in this workspace.' : 'People will appear after the workspace list loads.'}</p>}</div><p className={cn('mt-2 text-xs tabular-nums', muted)}>{reviewerIds.length} selected · choose 1–20 reviewers</p>{missingReviewers.length > 0 && <div className="mt-3 rounded-lg bg-amber-400/5 p-3 text-xs leading-5 text-amber-300"><p>A previously selected reviewer is no longer available.</p><Button type="button" variant="ghost" className={cn(press, 'mt-1 px-0 text-xs')} onClick={() => setReviewerIds(current => current.filter(id => !missingReviewers.includes(id)))}>Remove unavailable reviewers</Button></div>}</fieldset>
          {optionsError && <Notice>{optionsError}</Notice>}
          <Button type="button" variant="ghost" className={cn(press, 'px-0 text-xs')} onClick={() => void loadOptions()} disabled={optionsLoading || Boolean(pending)}><RefreshCw className={optionsLoading ? 'animate-spin' : ''} />Refresh channels and people</Button>
          <DailyDraftToggle checked={enabled} disabled={Boolean(pending)} onChange={setEnabled} />
          <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-border)] pt-5"><Button type="submit" disabled={Boolean(pending) || optionsLoading || !channelId || !reviewerIds.length || missingReviewers.length > 0 || !dirty} className={press}>{pending === 'save' ? <Loader2 className="animate-spin" /> : <Check />}Save approval settings</Button><Button type="button" variant="outline" disabled={Boolean(pending) || dirty || !settings.channelId || !settings.approverUserIds.length} onClick={() => void test()} className={press}>{pending === 'test' ? <Loader2 className="animate-spin" /> : <Send />}Send test</Button></div>
          {dirty && <p className={cn('text-xs', muted)}>Save your changes before sending a test.</p>}
          {testResult && <p role="status" className="text-sm leading-6 text-emerald-300">{testResult}</p>}
        </form>}
      </div>

      <div className="space-y-5">
        <section className={cn(panel, 'space-y-3')}><h2 className="text-base font-medium">Choose profiles and writing instructions</h2><p className={cn('text-sm leading-6', muted)}>Each connected social profile has its own audience, topics, voice, and post instructions. Enable the profiles you want daily drafts for.</p><Link to="/settings/research-profiles" className="inline-flex min-h-10 items-center gap-1 text-sm text-[var(--color-brand)] hover:underline">Manage research profiles<ArrowUpRight className="size-4" /></Link></section>
        <section className={cn(panel, 'space-y-3')}><h2 className="inline-flex items-center gap-2 text-sm font-medium"><ShieldCheck className="size-5 text-[var(--color-brand)]" />Review the latest version</h2><p className={cn('text-sm leading-6', muted)}>Reply to a draft’s Slack thread with an instruction such as “Make the opening shorter and remove the sales pitch.” The app revises the post and asks for approval again.</p><p className={cn('text-sm leading-6', muted)}>Only an explicit approval of the latest version can publish. Changes invalidate older approval buttons.</p><Link to="/research" className="inline-flex min-h-10 items-center gap-1 text-sm text-[var(--color-brand)] hover:underline">Open daily research<ArrowUpRight className="size-4" /></Link></section>
      </div>
    </div>

    <details id="slack-administrator-setup" open={administratorOpen} onToggle={event => setAdministratorOpen(event.currentTarget.open)} className={panel}>
      <summary className="min-h-10 cursor-pointer text-sm font-medium">Administrator setup and manual connection</summary>
      <div className="mt-4 grid gap-6 border-t border-[var(--color-border)] pt-5 lg:grid-cols-2">
        <section className="space-y-4"><h2 className="text-sm font-medium">One-time setup for your deployment</h2><p className={cn('text-xs leading-6', muted)}>The person hosting Content Hub creates one Slack app for the deployment. Each team owner then uses the Connect to Slack button.</p><ol className={cn('list-decimal space-y-3 pl-5 text-xs leading-6', muted)}><li>Download the manifest and <a href="https://api.slack.com/apps?new_app=1" target="_blank" rel="noopener noreferrer" className="text-[var(--color-brand)] hover:underline">create a Slack app<ExternalLink className="ml-1 inline size-3" /></a> using <strong>From a manifest</strong>.<Button asChild variant="outline" className={cn(press, 'mt-2 flex w-fit')}><a href="/api/slack/manifest" download="content-hub-slack-manifest.json"><ArrowDownToLine />Download app manifest</a></Button></li><li>Add the app’s <code>SLACK_CLIENT_ID</code>, <code>SLACK_CLIENT_SECRET</code>, and <code>SLACK_SIGNING_SECRET</code> to the deployment’s secret settings.</li><li>In the Slack app’s Event Subscriptions, verify the event address below and enable <code>message.channels</code> and <code>message.groups</code>. Confirm interactivity is enabled. The manifest includes the connection callback address.</li><li>Return here and choose <strong>Connect to Slack</strong> to authorize a workspace.</li></ol><div className="space-y-3">{[{ label: 'Connection callback', path: '/api/slack/oauth/callback' }, { label: 'Event subscriptions', path: '/api/slack/events' }, { label: 'Interactivity', path: '/api/slack/interactions' }].map(endpoint => <div key={endpoint.path}><p className={cn('mb-1 text-xs', muted)}>{endpoint.label}</p><div className="flex items-start gap-1 rounded-lg bg-[var(--color-bg-input)] p-2"><code className="min-w-0 flex-1 break-all text-xs leading-6">{origin}{endpoint.path}</code><Button type="button" variant="ghost" size="icon" className={cn(press, 'shrink-0')} aria-label={`Copy ${endpoint.label.toLowerCase()} address`} disabled={!origin} onClick={() => void copy(`${origin}${endpoint.path}`)}><Copy className="size-4" /></Button></div></div>)}</div></section>
        <form onSubmit={event => void save(event, true)} className="space-y-4"><h2 className="text-sm font-medium">Manual connection for an existing app</h2><p className={cn('text-xs leading-6', muted)}>Use this only when connecting an app with credentials you already manage. Saved secrets are never displayed.</p><div><label htmlFor="slack-bot-token" className="mb-2 block text-xs font-medium">Bot token</label><Input id="slack-bot-token" type="password" autoComplete="new-password" pattern="xoxb-[A-Za-z0-9-]+" value={botToken} onChange={event => setBotToken(event.target.value)} placeholder={settings?.hasBotToken ? 'Saved · enter a new token to replace' : 'xoxb-…'} disabled={!settings || Boolean(pending)} /></div><div><label htmlFor="slack-signing-secret" className="mb-2 block text-xs font-medium">Signing secret</label><Input id="slack-signing-secret" type="password" autoComplete="new-password" pattern="[a-fA-F0-9]{32}" value={signingSecret} onChange={event => setSigningSecret(event.target.value)} placeholder={settings?.hasSigningSecret ? 'Saved · enter a new secret to replace' : 'From the app’s Basic Information page'} disabled={!settings || Boolean(pending)} /></div><div><label htmlFor="slack-manual-channel" className="mb-2 block text-xs font-medium">Approval channel ID</label><Input id="slack-manual-channel" value={manualChannelId} onChange={event => setManualChannelId(event.target.value)} placeholder="C…" required pattern="[CG][A-Z0-9]{8,}" disabled={!settings || Boolean(pending)} /></div><div><label htmlFor="slack-manual-reviewers" className="mb-2 block text-xs font-medium">Reviewer member IDs</label><Input id="slack-manual-reviewers" value={manualReviewers} onChange={event => setManualReviewers(event.target.value)} placeholder="U0123456789, U0987654321" required aria-invalid={invalidManualReviewers || undefined} disabled={!settings || Boolean(pending)} /><p className={cn('mt-2 text-xs leading-5', muted)}>Comma-separated Slack member IDs. Invite the app to your approval channel before saving.</p></div><DailyDraftToggle checked={enabled} disabled={!settings || Boolean(pending)} onChange={setEnabled} /><Button type="submit" variant="outline" disabled={!settings || Boolean(pending) || invalidManualReviewers || !manualReviewerIds.length || !manualChannelId || !manualCredentialsReady} className={press}>{pending === 'save' ? <Loader2 className="animate-spin" /> : <Check />}Save manual connection</Button></form>
      </div>
    </details>
  </div>;
}

function errorMessage(cause: unknown) { return cause instanceof Error ? cause.message : 'Slack could not be reached. Please try again.'; }

function Notice({ children, success = false }: { children: ReactNode; success?: boolean }) {
  return <div role={success ? 'status' : 'alert'} className={cn('flex items-start gap-2 rounded-xl border p-4 text-sm leading-6', success ? 'border-emerald-400/20 bg-emerald-400/5 text-emerald-300' : 'border-amber-400/20 bg-amber-400/5 text-amber-300')}>{success ? <Check className="mt-0.5 size-5 shrink-0" /> : <AlertCircle className="mt-0.5 size-5 shrink-0" />}<div className="min-w-0">{children}</div></div>;
}

function DailyDraftToggle({ checked, disabled, onChange }: { checked: boolean; disabled: boolean; onChange: (value: boolean) => void }) {
  return <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl bg-[var(--color-bg-subtle)] p-3"><input type="checkbox" className="mt-1 size-4 accent-[var(--color-accent)]" checked={checked} onChange={event => onChange(event.target.checked)} disabled={disabled} /><span><span className="text-sm font-medium">Send daily drafts to Slack</span><span className={cn('mt-1 block text-xs leading-5', muted)}>Up to two strong matches from the last 24 hours. Quiet days stay quiet. Turn on daily research in the Research workspace.</span></span></label>;
}
