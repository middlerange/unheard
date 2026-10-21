// ABOUTME: RSS Feed settings page — manage auto-posting from RSS feeds.
// ABOUTME: Add blog, podcast, or YouTube feeds to auto-create posts.

import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Plus, Trash2, ChevronLeft, Rss, RefreshCw, CheckCircle2, AlertCircle, PauseCircle } from "@/components/icons";
import { cn } from '@/lib/utils';
import type { RssFeed } from '@/lib/db/types';

export const Route = createFileRoute('/settings/rss-feeds')({
  loader: async () => {
    const res = await fetch('/api/rss-feeds');
    if (!res.ok) throw new Error('Failed to load feeds');
    const data = await res.json();
    return data.feeds as RssFeed[];
  },
  component: RssFeedsSettings,
});

const FEED_TYPES = [
  { value: 'rss', label: 'RSS Feed' },
  { value: 'atom', label: 'Atom Feed' },
  { value: 'youtube', label: 'YouTube Channel' },
  { value: 'podcast', label: 'Podcast' },
] as const;

const FREQUENCIES = [
  { value: '15m', label: 'Every 15 minutes' },
  { value: '1h', label: 'Every hour' },
  { value: '6h', label: 'Every 6 hours' },
  { value: '24h', label: 'Daily' },
] as const;

const DEFAULT_TEMPLATE = '{{title}}\n\n{{link}}';

function RssFeedsSettings() {
  const initialFeeds = Route.useLoaderData();
  const [feeds, setFeeds] = useState<RssFeed[]>(initialFeeds);
  const [isAdding, setIsAdding] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [isToggling, setIsToggling] = useState<string | null>(null);
  
  const [newFeed, setNewFeed] = useState({
    name: '',
    url: '',
    feed_type: 'rss' as const,
    fetch_frequency: '1h' as const,
    post_template: DEFAULT_TEMPLATE,
    filter_keywords: '',
  });

  async function refresh() {
    const res = await fetch('/api/rss-feeds');
    if (res.ok) {
      const data = await res.json();
      setFeeds(data.feeds as RssFeed[]);
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFeed.name.trim() || !newFeed.url.trim()) return;
    
    setIsSaving(true);
    try {
      const res = await fetch('/api/rss-feeds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...newFeed,
          target_platforms: [],
          target_channels: [],
        }),
      });
      if (!res.ok) throw new Error('Failed to create feed');
      
      setIsAdding(false);
      setNewFeed({
        name: '',
        url: '',
        feed_type: 'rss',
        fetch_frequency: '1h',
        post_template: DEFAULT_TEMPLATE,
        filter_keywords: '',
      });
      toast.success('RSS feed added successfully');
      await refresh();
    } catch {
      toast.error('Failed to add RSS feed');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this RSS feed?')) return;
    
    setIsDeleting(id);
    try {
      const res = await fetch(`/api/rss-feeds?id=${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete feed');
      toast.success('RSS feed removed');
      await refresh();
    } catch {
      toast.error('Failed to remove RSS feed');
    } finally {
      setIsDeleting(null);
    }
  };

  const handleToggle = async (id: string, currentStatus: string) => {
    const newStatus = currentStatus === 'active' ? 'paused' : 'active';
    
    setIsToggling(id);
    try {
      const res = await fetch('/api/rss-feeds', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: newStatus }),
      });
      if (!res.ok) throw new Error('Failed to update feed');
      toast.success('Feed status updated');
      await refresh();
    } catch {
      toast.error('Failed to update feed status');
    } finally {
      setIsToggling(null);
    }
  };

  return (
    <div className="w-full px-6 py-6">
      {/* Header */}
      <div className="flex items-center gap-2 mb-6">
        <Link to="/settings" className="text-muted-foreground hover:text-foreground transition-colors">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-xl font-semibold">RSS Feed Auto-Posting</h1>
      </div>

      <p className="text-muted-foreground mb-6">
        Automatically create posts from RSS feeds, blogs, podcasts, or YouTube channels.
      </p>

      {/* Feed List */}
      {feeds.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <Rss className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">
              No RSS feeds configured yet. Add your first feed to start auto-posting.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4 mb-6">
          {feeds.map((feed) => (
            <Card key={feed.id} className={cn(feed.status !== 'active' && 'opacity-75')}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      'w-8 h-8 rounded-full flex items-center justify-center',
                      feed.status === 'active' ? 'bg-green-100 text-green-600' :
                      feed.status === 'paused' ? 'bg-yellow-100 text-yellow-600' :
                      'bg-red-100 text-red-600'
                    )}>
                      {feed.status === 'active' ? <CheckCircle2 className="w-4 h-4" /> :
                       feed.status === 'paused' ? <PauseCircle className="w-4 h-4" /> :
                       <AlertCircle className="w-4 h-4" />}
                    </div>
                    <div>
                      <CardTitle className="text-base">{feed.name}</CardTitle>
                      <CardDescription className="text-xs">{feed.url}</CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleToggle(feed.id, feed.status)}
                      disabled={isToggling === feed.id}
                    >
                      {feed.status === 'active' ? 'Pause' : 'Resume'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDelete(feed.id)}
                      disabled={isDeleting === feed.id}
                    >
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <RefreshCw className="w-3 h-3" />
                    {FREQUENCIES.find(f => f.value === feed.fetch_frequency)?.label}
                  </span>
                  <span>•</span>
                  <span className="capitalize">{feed.feed_type}</span>
                  {feed.last_fetched_at && (
                    <>
                      <span>•</span>
                      <span>Last checked: {new Date(feed.last_fetched_at).toLocaleDateString()}</span>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add Feed Form */}
      {isAdding ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add RSS Feed</CardTitle>
            <CardDescription>
              Configure auto-posting from an RSS feed, blog, or podcast.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Feed Name</Label>
                  <Input
                    id="name"
                    value={newFeed.name}
                    onChange={(e) => setNewFeed({ ...newFeed, name: e.target.value })}
                    placeholder="My Blog Feed"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="type">Feed Type</Label>
                  <Select
                    value={newFeed.feed_type}
                    onValueChange={(v) => setNewFeed({ ...newFeed, feed_type: v as typeof newFeed.feed_type })}
                  >
                    <SelectTrigger id="type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FEED_TYPES.map((type) => (
                        <SelectItem key={type.value} value={type.value}>
                          {type.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="url">Feed URL</Label>
                <Input
                  id="url"
                  type="url"
                  value={newFeed.url}
                  onChange={(e) => setNewFeed({ ...newFeed, url: e.target.value })}
                  placeholder="https://example.com/feed.xml"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="frequency">Check Frequency</Label>
                  <Select
                    value={newFeed.fetch_frequency}
                    onValueChange={(v) => setNewFeed({ ...newFeed, fetch_frequency: v as typeof newFeed.fetch_frequency })}
                  >
                    <SelectTrigger id="frequency">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FREQUENCIES.map((freq) => (
                        <SelectItem key={freq.value} value={freq.value}>
                          {freq.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="keywords">Filter Keywords (optional)</Label>
                  <Input
                    id="keywords"
                    value={newFeed.filter_keywords}
                    onChange={(e) => setNewFeed({ ...newFeed, filter_keywords: e.target.value })}
                    placeholder="startup, tech"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="template">Post Template</Label>
                <textarea
                  id="template"
                  value={newFeed.post_template}
                  onChange={(e) => setNewFeed({ ...newFeed, post_template: e.target.value })}
                  className="w-full min-h-[80px] rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                  placeholder="{{title}} {{link}}"
                />
                <p className="text-xs text-muted-foreground">
                  Use {'{{title}}'}, {'{{link}}'}, and {'{{description}}'} as placeholders.
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setIsAdding(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isSaving}>
                  {isSaving ? 'Adding...' : 'Add Feed'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : (
        <Button onClick={() => setIsAdding(true)} className="gap-2">
          <Plus className="w-4 h-4" />
          Add RSS Feed
        </Button>
      )}
    </div>
  );
}
