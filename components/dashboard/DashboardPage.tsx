// ABOUTME: Workspace dashboard for publishing activity and content metrics.
// ABOUTME: Metrics come from saved posts and ideas; no social performance is fabricated.

import { Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { ArrowDownToLine, ArrowUpRight, CalendarDays, Check, Clock3, FileText, Lightbulb, Info } from "@/components/icons";
import dayjs from 'dayjs';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useWorkspace } from '@/lib/workspace-context';
import { PLATFORM_DEFINITIONS, type PlatformId } from '@/lib/platforms';
import { htmlToText } from '@/lib/text';
import type { PostState } from '@/lib/db/types';

type Range = 7 | 30 | 90;
const STATUS_LABELS: Record<PostState, string> = {
  draft: 'Drafts', scheduled: 'Scheduled', awaiting_approval: 'Awaiting approval',
  publishing: 'Publishing', published: 'Published', failed: 'Failed',
};
const STATUS_COLORS: Record<PostState, string> = {
  draft: '#858692', scheduled: '#7774ed', awaiting_approval: '#a5a4b1',
  publishing: '#7774ed', published: '#58b88e', failed: '#e47478',
};

export function DashboardPage() {
  const { posts, ideas } = useWorkspace();
  const [range, setRange] = useState<Range>(30);
  const [platform, setPlatform] = useState<PlatformId | 'all'>('all');
  const filteredPosts = useMemo(() => platform === 'all'
    ? posts
    : posts.filter(post => post.targets.some(target => target.platform === platform)), [posts, platform]);
  const stateCounts = useMemo(() => {
    const counts: Record<PostState, number> = { draft: 0, scheduled: 0, awaiting_approval: 0, publishing: 0, published: 0, failed: 0 };
    filteredPosts.forEach(post => { counts[post.state] += 1; });
    return counts;
  }, [filteredPosts]);

  const activity = useMemo(() => {
    const today = dayjs().startOf('day');
    const days = Array.from({ length: range }, (_, index) => {
      const date = today.subtract(range - index - 1, 'day');
      return { key: date.format('YYYY-MM-DD'), label: range === 7 ? date.format('ddd') : date.format('D'), count: 0 };
    });
    const counts = new Map(days.map(day => [day.key, day]));
    filteredPosts.forEach(post => {
      const day = counts.get(dayjs(post.created_at).format('YYYY-MM-DD'));
      if (day) day.count += 1;
    });
    return days;
  }, [filteredPosts, range]);

  const platformCounts = useMemo(() => {
    const counts = new Map<PlatformId, Set<string>>();
    filteredPosts.forEach(post => post.targets.forEach(target => {
      if (platform !== 'all' && target.platform !== platform) return;
      const targetPlatform = target.platform as PlatformId;
      if (!PLATFORM_DEFINITIONS[targetPlatform]) return;
      const postIds = counts.get(targetPlatform) ?? new Set<string>();
      postIds.add(post.id);
      counts.set(targetPlatform, postIds);
    }));
    return [...counts.entries()]
      .map(([platform, postIds]) => ({ platform, count: postIds.size }))
      .sort((a, b) => b.count - a.count);
  }, [filteredPosts, platform]);

  const recentPosts = useMemo(() => [...filteredPosts].sort((a, b) => b.created_at - a.created_at).slice(0, 6), [filteredPosts]);
  const maxActivity = Math.max(1, ...activity.map(day => day.count));
  const maxPlatform = Math.max(1, ...platformCounts.map(item => item.count));
  const openIdeas = ideas.filter(idea => idea.status === 'open').length;

  function exportMetrics() {
    const rows = [
      ['Metric', 'Value'],
      ['Total posts', String(filteredPosts.length)],
      ...Object.entries(stateCounts).map(([state, count]) => [STATUS_LABELS[state as PostState], String(count)]),
      ['Ideas', String(ideas.length)],
      ['Open ideas', String(openIdeas)],
      ...platformCounts.map(({ platform, count }) => [`${PLATFORM_DEFINITIONS[platform].label} posts`, String(count)]),
    ];
    const csv = rows.map(row => row.map(value => `"${value.replaceAll('"', '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `content-hub-metrics-${dayjs().format('YYYY-MM-DD')}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6 pb-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-[var(--color-text-muted)]">Your publishing workspace at a glance</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="activity-range" className="sr-only">Activity range</label>
          <Select value={String(range)} onValueChange={value => setRange(Number(value) as Range)}>
            <SelectTrigger id="activity-range" className="h-9 border-[var(--color-border)] bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
          <label htmlFor="platform-filter" className="sr-only">Platform</label>
          <Select value={platform} onValueChange={value => setPlatform(value as PlatformId | 'all')}>
            <SelectTrigger id="platform-filter" className="h-9 border-[var(--color-border)] bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All platforms</SelectItem>
              {Object.entries(PLATFORM_DEFINITIONS).map(([id, definition]) => <SelectItem key={id} value={id}>{definition.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={exportMetrics} className="gap-2"><ArrowDownToLine className="size-4" />Export</Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Total posts" value={filteredPosts.length} detail={platform === 'all' ? 'Across all platforms' : `On ${PLATFORM_DEFINITIONS[platform].label}`} icon={FileText} />
        <MetricCard label="Published" value={stateCounts.published} detail="Successfully published" icon={Check} />
        <MetricCard label="Scheduled" value={stateCounts.scheduled + stateCounts.awaiting_approval} detail={`${stateCounts.awaiting_approval} awaiting approval`} icon={CalendarDays} />
        <MetricCard label="Drafts" value={stateCounts.draft} detail={`${ideas.length} ideas · ${openIdeas} open`} icon={Lightbulb} />
      </div>

      <div className="grid gap-3 xl:grid-cols-[1.6fr_1fr]">
        <Card className="p-5 sm:p-6">
            <div className="mb-5 flex items-start justify-between gap-4">
            <div><h2 className="text-base font-semibold">Post activity</h2><p className="mt-1 text-sm text-[var(--color-text-muted)]">Posts created in the last {range} days</p></div>
            <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-bg-muted)] px-2.5 py-1 text-xs text-[var(--color-text-muted)]">{activity.reduce((sum, day) => sum + day.count, 0)} posts</span>
          </div>
          <div className="flex h-48 items-end gap-1.5 sm:gap-2" role="img" aria-label={`Post creation activity over the last ${range} days`}>
            {activity.map(day => <div key={day.key} className="group flex h-full min-w-0 flex-1 flex-col justify-end gap-2 text-center">
              <div className="relative flex h-full items-end justify-center">
                {day.count > 0 && <span className="absolute -top-5 text-[10px] text-[var(--color-text-muted)] opacity-0 transition-opacity group-hover:opacity-100">{day.count}</span>}
                <div className="w-full max-w-5 rounded-t bg-[var(--color-accent)] transition-opacity group-hover:opacity-80" style={{ height: `${Math.max(day.count ? 8 : 0, day.count / maxActivity * 100)}%` }} />
              </div>
              {(range === 7 || (range === 30 && Number(day.label) % 5 === 0) || (range === 90 && activity.indexOf(day) % 14 === 0)) && <span className="truncate text-[10px] text-[var(--color-text-tertiary)]">{day.label}</span>}
            </div>)}
          </div>
        </Card>

        <Card className="p-5 sm:p-6">
          <div className="mb-5"><h2 className="text-base font-semibold">Publishing status</h2><p className="mt-1 text-sm text-[var(--color-text-muted)]">{platform === 'all' ? 'All posts in your workspace' : `Posts on ${PLATFORM_DEFINITIONS[platform].label}`}</p></div>
          <div className="space-y-4">
            {(Object.keys(STATUS_LABELS) as PostState[]).map(state => <div key={state}>
              <div className="mb-1.5 flex items-center justify-between text-sm"><span className="flex items-center gap-2 text-[var(--color-text-secondary)]"><span className="size-2 rounded-full" style={{ backgroundColor: STATUS_COLORS[state] }} />{STATUS_LABELS[state]}</span><span className="tabular-nums text-[var(--color-text-muted)]">{stateCounts[state]}</span></div>
              <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-bg-muted)]"><div className="h-full rounded-full" style={{ width: `${filteredPosts.length ? stateCounts[state] / filteredPosts.length * 100 : 0}%`, backgroundColor: STATUS_COLORS[state] }} /></div>
            </div>)}
          </div>
        </Card>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <Card className="p-5 sm:p-6">
          <div className="mb-5 flex items-center justify-between"><div><h2 className="text-base font-semibold">Platforms</h2><p className="mt-1 text-sm text-[var(--color-text-muted)]">Posts routed to each platform</p></div><Link to="/settings" className="inline-flex items-center gap-1 text-xs text-[var(--color-brand)] hover:underline">Settings<ArrowUpRight className="size-3.5" /></Link></div>
          {platformCounts.length ? <div className="space-y-4">{platformCounts.map(({ platform, count }) => <div key={platform}>
            <div className="mb-1.5 flex items-center justify-between text-sm"><span className="flex items-center gap-2 text-[var(--color-text-secondary)]"><span className="grid size-6 place-items-center rounded-md border border-[var(--color-border)] bg-[var(--color-bg-muted)] text-[10px] font-semibold text-[var(--color-text-secondary)]">{PLATFORM_DEFINITIONS[platform].shortLabel.slice(0, 2)}</span>{PLATFORM_DEFINITIONS[platform].label}</span><span className="text-[var(--color-text-muted)]">{count} posts</span></div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-bg-muted)]"><div className="h-full rounded-full bg-[var(--color-accent)]" style={{ width: `${count / maxPlatform * 100}%` }} /></div>
          </div>)}</div> : <EmptyState text="Your connected platforms will appear here." />}
        </Card>

        <Card className="p-5 sm:p-6">
          <div className="mb-4 flex items-center justify-between"><div><h2 className="text-base font-semibold">Recent posts</h2><p className="mt-1 text-sm text-[var(--color-text-muted)]">Latest content added to your workspace</p></div><Link to="/posts" search={{ status: 'all' }} className="inline-flex items-center gap-1 text-xs text-[var(--color-brand)] hover:underline">All posts<ArrowUpRight className="size-3.5" /></Link></div>
          {recentPosts.length ? <div className="divide-y divide-[var(--color-border-subtle)]">{recentPosts.map(post => {
            const content = htmlToText(post.targets[0]?.content ?? '') || '(No content yet)';
            return <Link key={post.id} to="/posts/$id" params={{ id: post.id }} search={{}} className="flex items-center gap-3 py-3 first:pt-1 last:pb-0 hover:bg-[var(--color-bg-muted)]/40">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--color-bg-muted)] text-[var(--color-text-muted)]"><Clock3 className="size-4" /></span>
              <span className="min-w-0 flex-1"><span className="block truncate text-sm text-[var(--color-text-secondary)]">{content}</span><span className="mt-1 block text-xs capitalize text-[var(--color-text-muted)]">{post.state.replaceAll('_', ' ')} · {dayjs(post.created_at).format('MMM D')}</span></span>
              <ArrowUpRight className="size-4 shrink-0 text-[var(--color-text-tertiary)]" />
            </Link>;
          })}</div> : <EmptyState text="Create your first post to see recent activity." />}
        </Card>
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-4 py-3.5 text-sm text-[var(--color-text-muted)]">
        <Info className="mt-0.5 size-4 shrink-0 text-[var(--color-text-muted)]" />
        <p>Publishing metrics reflect posts and platform routing saved in Content Hub. Social impressions and engagement are not available because connected platforms do not provide analytics to this app.</p>
      </div>
    </div>
  );
}

function MetricCard({ label, value, detail, icon: Icon }: { label: string; value: number; detail: string; icon: typeof FileText }) {
  return <Card className="p-5">
    <div className="flex items-start justify-between gap-4"><div><p className="text-sm text-[var(--color-text-muted)]">{label}</p><p className="mt-3 text-3xl font-semibold tracking-tight tabular-nums">{value.toLocaleString()}</p></div><span className="grid size-9 place-items-center rounded-lg bg-[var(--color-bg-muted)] text-[var(--color-text-muted)]"><Icon className="size-[18px]" /></span></div>
    <p className="mt-3 text-xs text-[var(--color-text-tertiary)]">{detail}</p>
  </Card>;
}

function EmptyState({ text }: { text: string }) {
  return <div className="flex items-center gap-2 rounded-lg border border-dashed border-[var(--color-border)] px-3 py-5 text-sm text-[var(--color-text-muted)]"><Info className="size-4 shrink-0" />{text}</div>;
}
