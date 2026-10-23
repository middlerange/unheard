import { createFileRoute, Link } from '@tanstack/react-router';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AlertCircle, ArrowUpRight, Check, ChevronLeft, Loader2, Mic2, RefreshCw, UserCircle } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { ResearchProfile } from '@/lib/research-profiles';

export const Route = createFileRoute('/settings/research-profiles')({ component: ResearchProfilesPage });

const panel = 'rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-5 shadow-panel sm:p-6';
const muted = 'text-[var(--color-text-muted)]';
const press = 'min-h-10 active:scale-[0.96] transition-[background-color,color,transform]';

function ResearchProfilesPage() {
  const [profiles, setProfiles] = useState<ResearchProfile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/research/profiles');
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not load research profiles.');
      setProfiles(result.profiles);
      setError(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load research profiles.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return <div className="mx-auto max-w-4xl space-y-6">
    <div className="flex items-start gap-3"><Button asChild variant="ghost" size="icon" className={press}><Link to="/settings" aria-label="Back to settings"><ChevronLeft /></Link></Button><div><h1 className="text-xl font-semibold tracking-tight">Research profiles</h1><p className={cn('mt-2 max-w-2xl text-sm leading-6', muted)}>Choose which connected profiles get daily post drafts. Tell each one who it speaks to, what it should cover, and how it should sound.</p></div></div>
    <div className={cn(panel, 'flex items-start gap-3')}><Mic2 className="mt-0.5 size-5 shrink-0 text-[var(--color-brand)]" /><div className="min-w-0"><p className="text-sm font-medium">One identity per story</p><p className={cn('mt-2 text-sm leading-6', muted)}>Each story goes to one identity group, with drafts for all of that group’s enabled, supported text channels. Each profile’s instructions guide its platform’s version. Accounts without a custom group stay separate.</p><p className={cn('mt-2 text-sm leading-6', muted)}>Your shared research audience helps find useful sources. Keep distinct identities in separate account groups, and enable only the profiles you want to review in Slack.</p><div className="mt-2 flex flex-wrap gap-x-5"><Link to="/research" className="inline-flex min-h-10 items-center gap-1 text-sm text-[var(--color-brand)] hover:underline">Research workspace<ArrowUpRight className="size-4" /></Link><Link to="/settings/slack" className="inline-flex min-h-10 items-center gap-1 text-sm text-[var(--color-brand)] hover:underline">Slack approvals<ArrowUpRight className="size-4" /></Link><a href="/settings/channels" className="inline-flex min-h-10 items-center gap-1 text-sm text-[var(--color-brand)] hover:underline">Manage connected accounts<ArrowUpRight className="size-4" /></a></div></div></div>
    {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-400/20 bg-amber-400/5 p-4 text-sm text-amber-300"><span className="inline-flex items-center gap-2"><AlertCircle className="size-5 shrink-0" />{error}</span><Button variant="outline" className={press} onClick={() => void load()}><RefreshCw />Try again</Button></div>}
    {!profiles && !error && <div className={cn(panel, 'flex min-h-48 items-center justify-center gap-3 text-sm', muted)}><Loader2 className="size-5 animate-spin" />Loading connected profiles…</div>}
    {profiles?.length === 0 && <div className={cn(panel, 'py-12 text-center')}><UserCircle className="mx-auto mb-4 size-10 text-[var(--color-text-muted)]" /><h2 className="text-base font-medium">Connect your first profile</h2><p className={cn('mx-auto mt-2 max-w-md text-sm leading-6', muted)}>Add a social account, then come back to choose its research topics and writing instructions.</p><Button asChild variant="outline" className={cn(press, 'mt-5')}><a href="/settings/channels">Manage connected accounts<ArrowUpRight /></a></Button></div>}
    <div className="space-y-4">{profiles?.map(profile => <ProfileCard key={profile.id} profile={profile} onSaved={saved => setProfiles(current => current?.map(item => item.id === saved.id ? saved : item) ?? null)} />)}</div>
  </div>;
}

function ProfileCard({ profile, onSaved }: { profile: ResearchProfile; onSaved: (profile: ResearchProfile) => void }) {
  const [enabled, setEnabled] = useState(profile.enabled);
  const [prompt, setPrompt] = useState(profile.systemPrompt);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = enabled !== profile.enabled || prompt !== profile.systemPrompt;
  const configuredGroup = profile.groupName?.trim();
  const identityLabel = configuredGroup && !['default', 'ungrouped'].includes(configuredGroup.toLowerCase()) ? configuredGroup : 'Separate identity';
  return <form className={cn(panel, 'space-y-5')} onSubmit={async event => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/research/profiles', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: profile.id, enabled, systemPrompt: prompt }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not save this profile.');
      const saved = (result.profiles as ResearchProfile[]).find(item => item.id === profile.id);
      if (!saved) throw new Error('The saved profile was not returned. Reload this page to check it.');
      onSaved(saved);
      setEnabled(saved.enabled);
      setPrompt(saved.systemPrompt);
      toast.success(`${profile.name} research settings saved.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save this profile.'); }
    finally { setPending(false); }
  }}>
    <div className="flex flex-wrap items-start justify-between gap-4"><div className="flex min-w-0 max-w-full items-center gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--color-accent)]/10 text-[var(--color-brand)]"><UserCircle className="size-5" /></div><div className="min-w-0"><h2 className="text-base font-medium [overflow-wrap:anywhere]">{profile.name}</h2><p className={cn('mt-1 text-xs capitalize', muted)}>{profile.platform === 'twitter' ? 'X' : profile.platform}</p><p className={cn('mt-2 text-xs leading-5 [overflow-wrap:anywhere]', muted)}>Identity group: <span className="font-medium text-[var(--color-text-secondary)]">{identityLabel}</span></p></div></div><label className="inline-flex min-h-10 cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} disabled={pending || !profile.supported || profile.requiresMedia} className="size-4 accent-[var(--color-accent)]" />Daily drafts</label></div>
    {(!profile.supported || profile.requiresMedia) && <p className="rounded-xl bg-amber-400/5 p-3 text-xs leading-5 text-amber-300">{profile.requiresMedia ? 'This profile requires media. Daily research currently prepares text posts, so this profile cannot receive daily drafts yet.' : 'Daily research drafting is not available for this platform yet.'}</p>}
    <div><label htmlFor={`research-prompt-${profile.id}`} className="mb-2 block text-sm font-medium">Audience and writing instructions</label><Textarea id={`research-prompt-${profile.id}`} rows={6} maxLength={8000} minLength={enabled ? 20 : undefined} value={prompt} onChange={event => setPrompt(event.target.value)} disabled={pending} placeholder="Who is this profile for? Which topics matter? Describe the voice, format, examples to use, and anything to avoid." className="min-h-40 text-sm leading-6" /><p className={cn('mt-2 text-xs leading-5', muted)}>Use at least 20 characters when enabling daily drafts. For example: “Write for product leaders at B2B SaaS companies. Focus on practical adoption lessons. Use my direct, conversational voice. Credit the source, avoid sales pitches, and end with a specific question.”</p></div>
    {error && <p role="alert" className="text-sm text-amber-300">{error}</p>}
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] pt-4"><p className={cn('text-xs leading-5', muted)}>{enabled ? 'New drafts use these instructions. Publishing still needs Slack approval.' : 'Daily drafts are off for this profile.'}</p><Button type="submit" disabled={pending || !dirty || (enabled && prompt.trim().length < 20)} className={press}>{pending ? <Loader2 className="animate-spin" /> : <Check />}Save profile</Button></div>
  </form>;
}
