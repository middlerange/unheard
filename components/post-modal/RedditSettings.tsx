// ABOUTME: Reddit-specific destination, title, link, flair, and safety controls.
// ABOUTME: Keeps required Reddit metadata visible beside the Reddit content editor.

import { useEffect, useState } from 'react';
import { Loader2 } from "@/components/icons";
import { RedditLogo } from '@/components/RedditLogo';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getRedditFlairs } from '@/app/server-fns/reddit-connect';

type RedditPostType = 'self' | 'link';

export type RedditSettingsValue = {
  title: string;
  subreddit: string;
  postType: RedditPostType;
  url: string;
  flairId: string;
  nsfw: boolean;
  spoiler: boolean;
};

type Flair = {
  id: string;
  text: string;
  backgroundColor: string;
  textColor: string;
};

export function RedditSettings({
  value,
  channelId,
  onChange,
}: {
  value: RedditSettingsValue;
  channelId?: string;
  onChange: (patch: Partial<RedditSettingsValue>) => void;
}) {
  const [flairs, setFlairs] = useState<Flair[]>([]);
  const [loadingFlairs, setLoadingFlairs] = useState(false);
  const subreddit = value.subreddit.replace(/^\/?r\//i, '');

  useEffect(() => {
    if (!channelId || !/^[A-Za-z0-9_]{2,100}$/.test(subreddit)) {
      setFlairs([]);
      return;
    }

    let active = true;
    const timer = window.setTimeout(async () => {
      setLoadingFlairs(true);
      try {
        const result = await getRedditFlairs({ data: { channelId, subreddit } });
        if (active) setFlairs(result);
      } catch {
        if (active) setFlairs([]);
      } finally {
        if (active) setLoadingFlairs(false);
      }
    }, 300);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [channelId, subreddit]);

  return (
    <section className="mb-3 space-y-3 rounded-xl bg-[#FF4500]/[0.045] p-4 ring-1 ring-[#FF4500]/15">
      <div className="flex items-start gap-2.5">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#FF4500]/10 text-[#FF4500]">
          <RedditLogo className="size-4" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-balance">Reddit post details</h3>
          <p className="mt-0.5 text-xs text-muted-foreground text-pretty">
            Choose the destination and format. Posts are published by the connected Reddit user; shared media is omitted from this text/link version.
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_140px]">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="reddit-title" className="text-xs">Title</Label>
            <span className="text-[10px] text-muted-foreground tabular-nums">{value.title.length}/300</span>
          </div>
          <Input
            id="reddit-title"
            value={value.title}
            onChange={event => onChange({ title: event.target.value })}
            maxLength={300}
            className="h-10 bg-background text-sm"
            placeholder="What should Redditors know?"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="reddit-subreddit" className="text-xs">Subreddit</Label>
          <div className="flex items-center">
            <span className="flex h-10 items-center rounded-l-md border border-r-0 border-input bg-background px-2.5 text-sm text-muted-foreground">r/</span>
            <Input
              id="reddit-subreddit"
              value={subreddit}
              onChange={event => onChange({ subreddit: event.target.value.replace(/^\/?r\//i, '') })}
              className="h-10 min-w-0 rounded-l-none bg-background text-sm"
              placeholder="Userorbit"
              autoComplete="off"
            />
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Post type</Label>
          <Select value={value.postType} onValueChange={postType => onChange({ postType: postType as RedditPostType })}>
            <SelectTrigger className="h-10 bg-background text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="self">Text post</SelectItem>
              <SelectItem value="link">Link post</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Flair</Label>
          <Select
            value={value.flairId || 'none'}
            onValueChange={flairId => onChange({ flairId: flairId === 'none' ? '' : flairId })}
            disabled={loadingFlairs || flairs.length === 0}
          >
            <SelectTrigger className="h-10 bg-background text-xs">
              {loadingFlairs ? (
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" />
                  Loading flairs…
                </span>
              ) : (
                <SelectValue placeholder={flairs.length ? 'Optional flair' : 'No flairs available'} />
              )}
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No flair</SelectItem>
              {flairs.map(flair => (
                <SelectItem key={flair.id} value={flair.id}>{flair.text || 'Untitled flair'}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {value.postType === 'link' && (
        <div className="space-y-1.5">
          <Label htmlFor="reddit-url" className="text-xs">Article URL</Label>
          <Input
            id="reddit-url"
            type="url"
            value={value.url}
            onChange={event => onChange({ url: event.target.value })}
            className="h-10 bg-background text-sm"
            placeholder="https://userorbit.com/blog/..."
          />
        </div>
      )}

      <div className="flex flex-wrap gap-x-5 gap-y-2">
        <label className="flex min-h-10 cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <Checkbox checked={value.nsfw} onCheckedChange={checked => onChange({ nsfw: Boolean(checked) })} />
          Mark NSFW
        </label>
        <label className="flex min-h-10 cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <Checkbox checked={value.spoiler} onCheckedChange={checked => onChange({ spoiler: Boolean(checked) })} />
          Mark as spoiler
        </label>
      </div>
    </section>
  );
}
