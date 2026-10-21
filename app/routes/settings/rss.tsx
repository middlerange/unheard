// ABOUTME: RSS Feed settings page — auto-post from RSS, Atom, YouTube, Podcast feeds
// ABOUTME: Configure feed sources, posting templates, and target platforms.

import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Trash2, ChevronLeft, RefreshCw, ExternalLink } from "@/components/icons";
import { listRssFeeds, createRssFeed, deleteRssFeed, fetchRssFeed, getFeedItems } from '@/app/server-fns/rss';
import { getChannels } from '@/app/server-fns/channels';
import { cn } from '@/lib/utils';
import type { RssFeed, RssFeedItem } from '@/lib/db/types';
import type { ChannelView } from '@/app/server-fns/channels';

export const Route = createFileRoute('/settings/rss')({
  loader: async () => {
    const [feeds, channels] = await Promise.all([listRssFeeds(), getChannels()]);
    return { feeds, channels };
  },
  component: RssSettings,
});

const FEED_TYPES = [
  { id: 'rss', label: 'RSS 2.0', icon: '📰' },
  { id: 'atom', label: 'Atom', icon: '⚛️' },
  { id: 'youtube', label: 'YouTube', icon: '📺' },
  { id: 'podcast', label: 'Podcast', icon: '🎙️' },
];

const FREQUENCIES = [
  { id: '15m', label: '15 minutes' },
  { id: '1h', label: '1 hour' },
  { id: '6h', label: '6 hours' },
  { id: '24h', label: '24 hours' },
];

function RssSettings() {
  const { feeds: initialFeeds, channels: initialChannels } = Route.useLoaderData();
  const [feeds, setFeeds] = useState<RssFeed[]>(initialFeeds);
  const [channels] = useState<ChannelView[]>(initialChannels);
  const [adding, setAdding] = useState(false);
  const [loadingItems, setLoadingItems] = useState<string | null>(null);
  const [feedItems, setFeedItems] = useState<Record<string, RssFeedItem[]>>({});
  
  // Form state
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [feedType, setFeedType] = useState('rss');
  const [frequency, setFrequency] = useState('1h');
  const [template, setTemplate] = useState('{{title}}\n\n{{link}}');
  const [filterKeywords, setFilterKeywords] = useState('');
  const [selectedChannels, setSelectedChannels] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);

  async function refresh() {
    setFeeds(await listRssFeeds());
  }

  function resetForm() {
    setName('');
    setUrl('');
    setFeedType('rss');
    setFrequency('1h');
    setTemplate('{{title}}\n\n{{link}}');
    setFilterKeywords('');
    setSelectedChannels([]);
    setAdding(false);
  }

  async function handleAdd() {
    if (!name.trim() || !url.trim()) {
      toast.error('Name and URL are required');
      return;
    }

    setSaving(true);
    try {
      await createRssFeed({
        data: {
          name: name.trim(),
          url: url.trim(),
          feedType: feedType as 'rss' | 'atom' | 'youtube' | 'podcast',
          fetchFrequency: frequency as '15m' | '1h' | '6h' | '24h',
          postTemplate: template,
          targetPlatforms: selectedChannels.map(id => {
            const ch = channels.find(c => c.id === id);
            return ch?.platform || 'twitter';
          }),
          targetChannels: selectedChannels,
          filterKeywords: filterKeywords.trim(),
        },
      });
      resetForm();
      await refresh();
      toast.success('RSS feed added');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to add feed');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteRssFeed({ data: { id } });
      await refresh();
      toast.success('Feed deleted');
    } catch (error) {
      toast.error('Failed to delete feed');
    }
  }

  async function handleTest(feedId: string) {
    setTesting(feedId);
    try {
      const result = await fetchRssFeed({ data: { feedId } });
      await refresh();
      toast.success(`Fetched ${result.itemsFound} items, ${result.processed} posts created`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Feed fetch failed');
    } finally {
      setTesting(null);
    }
  }

  async function handleLoadItems(feedId: string) {
    setLoadingItems(feedId);
    try {
      const items = await getFeedItems({ data: { feedId } });
      setFeedItems(prev => ({ ...prev, [feedId]: items }));
    } catch (error) {
      toast.error('Failed to load items');
    } finally {
      setLoadingItems(null);
    }
  }

  const availableChannels = channels.filter(c => c.platform !== 'discord');

  return (
    <div className="px-6 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/settings" className="text-muted-foreground hover:text-foreground transition-colors">
            <ChevronLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="text-xl font-semibold">RSS Auto-Posting</h1>
            <p className="text-xs text-muted-foreground">Auto-post from RSS feeds, blogs, YouTube, and podcasts</p>
          </div>
        </div>
        <Button size="sm" className="gap-1.5 text-xs" onClick={() => setAdding(true)} disabled={adding}>
          <Plus className="w-3.5 h-3.5" />
          Add feed
        </Button>
      </div>

      {adding && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Feed Name</Label>
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Company Blog"
              className="text-sm h-8"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Feed URL</Label>
            <Input
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://example.com/feed.xml"
              className="text-sm h-8"
            />
          </div>

          <div className="flex gap-4">
            <div className="space-y-1.5 flex-1">
              <Label className="text-xs">Feed Type</Label>
              <div className="flex gap-2">
                {FEED_TYPES.map(type => (
                  <button
                    key={type.id}
                    type="button"
                    onClick={() => setFeedType(type.id)}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs transition-colors',
                      feedType === type.id ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <span>{type.icon}</span>
                    {type.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5 flex-1">
              <Label className="text-xs">Check Frequency</Label>
              <div className="flex gap-2">
                {FREQUENCIES.map(freq => (
                  <button
                    key={freq.id}
                    type="button"
                    onClick={() => setFrequency(freq.id)}
                    className={cn(
                      'px-3 py-1.5 rounded-md border text-xs transition-colors',
                      frequency === freq.id ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {freq.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Post Template</Label>
            <Textarea
              value={template}
              onChange={e => setTemplate(e.target.value)}
              className="text-sm min-h-[80px] font-mono"
              placeholder="{{title}} {{link}}"
            />
            <p className="text-xs text-muted-foreground">
              Available variables: {'{{title}}'}, {'{{link}}'}, {'{{description}}'}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Filter Keywords (optional)</Label>
            <Input
              value={filterKeywords}
              onChange={e => setFilterKeywords(e.target.value)}
              placeholder="startup, product, launch (comma-separated)"
              className="text-sm h-8"
            />
            <p className="text-xs text-muted-foreground">Only posts containing these keywords will be auto-posted</p>
          </div>

          {availableChannels.length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs">Post to Channels</Label>
              <div className="flex flex-wrap gap-2">
                {availableChannels.map(ch => (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() => setSelectedChannels(prev =>
                      prev.includes(ch.id) ? prev.filter(id => id !== ch.id) : [...prev, ch.id]
                    )}
                    className={cn(
                      'px-3 py-1.5 rounded-md border text-xs transition-colors',
                      selectedChannels.includes(ch.id) ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {ch.platform}: {ch.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button size="sm" className="text-xs h-7" onClick={handleAdd} disabled={saving}>
              {saving ? 'Adding...' : 'Add Feed'}
            </Button>
            <Button size="sm" variant="ghost" className="text-xs h-7" onClick={resetForm}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {feeds.length === 0 && !adding && (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-sm text-muted-foreground mb-2">No RSS feeds configured yet.</p>
          <p className="text-xs text-muted-foreground">Add feeds to auto-post new content to your social channels.</p>
        </div>
      )}

      {feeds.map(feed => (
        <div key={feed.id} className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="p-4 space-y-3">
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium">{feed.name}</h3>
                  <span className={cn(
                    'text-[10px] px-1.5 py-0.5 rounded-full uppercase tracking-wide',
                    feed.status === 'active' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                    feed.status === 'error' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                    'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                  )}>
                    {feed.status}
                  </span>
                </div>
                <a
                  href={feed.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mt-1"
                >
                  {feed.url}
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-xs h-7"
                  onClick={() => handleTest(feed.id)}
                  disabled={testing === feed.id}
                >
                  <RefreshCw className={cn('w-3.5 h-3.5 mr-1', testing === feed.id && 'animate-spin')} />
                  Test
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-xs h-7 text-muted-foreground hover:text-destructive"
                  onClick={() => handleDelete(feed.id)}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>Type: {FEED_TYPES.find(t => t.id === feed.feed_type)?.label || feed.feed_type}</span>
              <span>Frequency: {FREQUENCIES.find(f => f.id === feed.fetch_frequency)?.label || feed.fetch_frequency}</span>
              {feed.last_fetched_at && (
                <span>Last checked: {new Date(feed.last_fetched_at).toLocaleString()}</span>
              )}
            </div>

            {feedItems[feed.id] && (
              <div className="border-t border-border pt-3 mt-3">
                <h4 className="text-xs font-medium mb-2">Recent Items</h4>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {feedItems[feed.id].map(item => (
                    <div key={item.id} className="flex items-start gap-2 text-xs p-2 rounded bg-muted/50">
                      <span className={cn(
                        'w-2 h-2 rounded-full mt-0.5',
                        item.status === 'posted' ? 'bg-green-500' :
                        item.status === 'filtered' ? 'bg-yellow-500' :
                        item.status === 'error' ? 'bg-red-500' :
                        'bg-gray-400'
                      )} />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{item.title}</p>
                        <p className="text-muted-foreground">{item.published_at ? new Date(item.published_at).toLocaleDateString() : 'No publish date'}</p>
                        {item.status === 'error' && item.error_message && (
                          <p className="text-red-500 mt-1">{item.error_message}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!feedItems[feed.id] && (
              <Button
                size="sm"
                variant="ghost"
                className="text-xs h-6"
                onClick={() => handleLoadItems(feed.id)}
                disabled={loadingItems === feed.id}
              >
                {loadingItems === feed.id ? 'Loading...' : 'Show recent items'}
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
