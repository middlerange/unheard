// ABOUTME: Channels settings page — manage social media accounts.
// ABOUTME: Credentials are encrypted before storing; never shown after save.

import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, ChevronLeft, Twitter, Linkedin, Instagram, Facebook, Youtube } from "@/components/icons";
import { RedditLogo } from '@/components/RedditLogo';
import { getChannels, createChannel, deleteChannel, setDefaultChannel, type ChannelView } from '@/app/server-fns/channels';
import { getConnectAvailability, startLinkedInConnect, startMetaConnect, startYouTubeConnect } from '@/app/server-fns/social-connect';
import { startRedditConnect } from '@/app/server-fns/reddit-connect';
import { startTwitterConnect } from '@/app/server-fns/twitter-connect';
import { cn } from '@/lib/utils';
import { SUPPORTED_PLATFORMS, PLATFORM_DEFINITIONS, type PlatformId } from '@/lib/platforms';

export const Route = createFileRoute('/settings/channels')({
  validateSearch: search => ({
    twitter_connected: search.twitter_connected === '1' ? '1' : undefined,
    twitter_error: typeof search.twitter_error === 'string' ? search.twitter_error : undefined,
    linkedin_connected: search.linkedin_connected === '1' ? '1' : undefined,
    linkedin_profile: typeof search.linkedin_profile === 'string' ? search.linkedin_profile : undefined,
    linkedin_error: typeof search.linkedin_error === 'string' ? search.linkedin_error : undefined,
    reddit_connected: search.reddit_connected === '1' ? '1' : undefined,
    reddit_username: typeof search.reddit_username === 'string' ? search.reddit_username : undefined,
    reddit_error: typeof search.reddit_error === 'string' ? search.reddit_error : undefined,
    meta_connected: search.meta_connected === '1' ? '1' : undefined,
    meta_summary: typeof search.meta_summary === 'string' ? search.meta_summary : undefined,
    meta_error: typeof search.meta_error === 'string' ? search.meta_error : undefined,
    youtube_connected: search.youtube_connected === '1' ? '1' : undefined,
    youtube_channel: typeof search.youtube_channel === 'string' ? search.youtube_channel : undefined,
    youtube_error: typeof search.youtube_error === 'string' ? search.youtube_error : undefined,
  }),
  loader: async () => {
    const [channels, availability] = await Promise.all([getChannels(), getConnectAvailability()]);
    return { channels, availability };
  },
  component: ChannelSettings,
});

type Platform = PlatformId;
type AccountType = 'personal' | 'company' | 'page';

interface TwitterFields {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessTokenSecret: string;
  premium: boolean;
}

interface LinkedInFields {
  accessToken: string;
  orgId: string;
}

interface RedditFields {
  defaultSubreddit: string;
}

interface YouTubeFields {
  privacyStatus: 'private' | 'unlisted' | 'public';
  notifySubscribers: boolean;
}

interface DiscordFields {
  webhookUrl: string;
  useWebhook: boolean;
  botToken: string;
  channelId: string;
}

function emptyTwitter(): TwitterFields {
  return { apiKey: '', apiSecret: '', accessToken: '', accessTokenSecret: '', premium: false };
}

function emptyLinkedIn(): LinkedInFields {
  return { accessToken: '', orgId: '' };
}

function emptyReddit(): RedditFields {
  return { defaultSubreddit: 'Userorbit' };
}

function emptyYouTube(): YouTubeFields {
  return {
    privacyStatus: 'private',
    notifySubscribers: false,
  };
}

function emptyDiscord(): DiscordFields {
  return { webhookUrl: '', useWebhook: true, botToken: '', channelId: '' };
}

function platformIcon(platform: Platform, className = 'w-3 h-3') {
  switch (platform) {
    case 'twitter':
      return <Twitter className={`${className} text-[#1d9bf0]`} />;
    case 'linkedin':
      return <Linkedin className={`${className} text-[#0a66c2]`} />;
    case 'instagram':
      return <Instagram className={`${className} text-[#E4405F]`} />;
    case 'facebook':
      return <Facebook className={`${className} text-[#1877F2]`} />;
    case 'youtube':
      return <Youtube className={`${className} text-[#FF0000]`} />;
    case 'reddit':
      return <RedditLogo className={`${className} text-[#FF4500]`} />;
    case 'discord':
      return (
        <svg className={className} viewBox="0 0 24 24" fill="#5865F2">
          <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/>
        </svg>
      );
    default:
      return null;
  }
}

function ChannelSettings() {
  const { channels: initialChannels, availability } = Route.useLoaderData();
  const search = Route.useSearch();
  const [channels, setChannels] = useState<ChannelView[]>(initialChannels);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPlatform, setNewPlatform] = useState<Platform>('twitter');
  const [newAccountType, setNewAccountType] = useState<AccountType>('personal');
  const [newTwitter, setNewTwitter] = useState<TwitterFields>(emptyTwitter());
  const [newLinkedIn, setNewLinkedIn] = useState<LinkedInFields>(emptyLinkedIn());
  const [newReddit, setNewReddit] = useState<RedditFields>(emptyReddit());
  const [newYouTube, setNewYouTube] = useState<YouTubeFields>(emptyYouTube());
  const [newDiscord, setNewDiscord] = useState<DiscordFields>(emptyDiscord());
  const [saving, setSaving] = useState(false);
  const [connectingTwitter, setConnectingTwitter] = useState(false);
  const [connectingLinkedIn, setConnectingLinkedIn] = useState(false);
  const [connectingReddit, setConnectingReddit] = useState(false);
  const [connectingMeta, setConnectingMeta] = useState(false);
  const [connectingYouTube, setConnectingYouTube] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (search.twitter_connected) {
      toast.success('Twitter channel connected');
      window.history.replaceState(null, '', '/settings/channels');
      setConnectingTwitter(false);
    }
  }, [search.twitter_connected]);

  useEffect(() => {
    if (search.twitter_error) {
      toast.error(search.twitter_error);
      window.history.replaceState(null, '', '/settings/channels');
      setConnectingTwitter(false);
    }
  }, [search.twitter_error]);

  useEffect(() => {
    if (search.linkedin_connected) {
      toast.success(search.linkedin_profile ? `Connected ${search.linkedin_profile} and refreshed LinkedIn channels` : 'LinkedIn channels connected');
      window.history.replaceState(null, '', '/settings/channels');
      setConnectingLinkedIn(false);
    }
  }, [search.linkedin_connected, search.linkedin_profile]);

  useEffect(() => {
    if (search.linkedin_error) {
      toast.error(search.linkedin_error);
      window.history.replaceState(null, '', '/settings/channels');
      setConnectingLinkedIn(false);
    }
  }, [search.linkedin_error]);

  useEffect(() => {
    if (search.reddit_connected) {
      toast.success(search.reddit_username ? `Connected u/${search.reddit_username}` : 'Reddit channel connected');
      window.history.replaceState(null, '', '/settings/channels');
      setConnectingReddit(false);
    }
  }, [search.reddit_connected, search.reddit_username]);

  useEffect(() => {
    if (search.reddit_error) {
      toast.error(search.reddit_error);
      window.history.replaceState(null, '', '/settings/channels');
      setConnectingReddit(false);
    }
  }, [search.reddit_error]);

  useEffect(() => {
    if (search.meta_connected) {
      toast.success(search.meta_summary || 'Meta channels connected');
      window.history.replaceState(null, '', '/settings/channels');
      setConnectingMeta(false);
    }
  }, [search.meta_connected, search.meta_summary]);

  useEffect(() => {
    if (search.meta_error) {
      toast.error(search.meta_error);
      window.history.replaceState(null, '', '/settings/channels');
      setConnectingMeta(false);
    }
  }, [search.meta_error]);

  useEffect(() => {
    if (search.youtube_connected) {
      toast.success(search.youtube_channel ? `Connected ${search.youtube_channel}` : 'YouTube channel connected');
      window.history.replaceState(null, '', '/settings/channels');
      setConnectingYouTube(false);
    }
  }, [search.youtube_channel, search.youtube_connected]);

  useEffect(() => {
    if (search.youtube_error) {
      toast.error(search.youtube_error);
      window.history.replaceState(null, '', '/settings/channels');
      setConnectingYouTube(false);
    }
  }, [search.youtube_error]);

  async function refresh() {
    setChannels(await getChannels());
  }

  function buildCredentials(): Record<string, unknown> {
    switch (newPlatform) {
      case 'twitter':
        return {
          apiKey: newTwitter.apiKey,
          apiSecret: newTwitter.apiSecret,
          accessToken: newTwitter.accessToken,
          accessTokenSecret: newTwitter.accessTokenSecret,
          premium: newTwitter.premium,
        };
      case 'linkedin': {
        const creds: Record<string, unknown> = { accessToken: newLinkedIn.accessToken };
        if (newLinkedIn.orgId.trim()) creds.orgId = newLinkedIn.orgId.trim();
        return creds;
      }
      case 'youtube':
        return {
          privacyStatus: newYouTube.privacyStatus,
          notifySubscribers: newYouTube.notifySubscribers,
        };
      case 'discord':
        if (newDiscord.useWebhook) {
          return { type: 'webhook', webhookUrl: newDiscord.webhookUrl };
        }
        return { type: 'bot', botToken: newDiscord.botToken, channelId: newDiscord.channelId };
      default:
        return {};
    }
  }

  function canCreate(): boolean {
    if (!newName.trim()) return false;

    switch (newPlatform) {
      case 'twitter':
        return Boolean(newTwitter.accessToken.trim() && newTwitter.accessTokenSecret.trim());
      case 'linkedin':
        return Boolean(newLinkedIn.accessToken.trim());
      case 'reddit':
        return false;
      case 'youtube':
        return false;
      case 'instagram':
      case 'facebook':
        return false;
      case 'discord':
        return newDiscord.useWebhook
          ? Boolean(newDiscord.webhookUrl.trim())
          : Boolean(newDiscord.botToken.trim() && newDiscord.channelId.trim());
      default:
        return true;
    }
  }

  function resetForm() {
    setNewName('');
    setNewPlatform('twitter');
    setNewAccountType('personal');
    setNewTwitter(emptyTwitter());
    setNewLinkedIn(emptyLinkedIn());
    setNewReddit(emptyReddit());
    setNewYouTube(emptyYouTube());
    setNewDiscord(emptyDiscord());
    setAdding(false);
  }

  async function handleAdd() {
    if (!canCreate()) return;
    setSaving(true);
    try {
      await createChannel({
        data: {
          name: newName.trim(),
          platform: newPlatform,
          account_type: newAccountType,
          is_default: channels.filter(ch => ch.platform === newPlatform).length === 0,
          credentials: buildCredentials(),
        },
      });
      resetForm();
      await refresh();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await deleteChannel({ data: { id } });
      await refresh();
    } finally {
      setDeletingId(null);
    }
  }

  async function handleTwitterConnect() {
    if (!newTwitter.apiKey.trim() || !newTwitter.apiSecret.trim()) {
      toast.error('Add the Twitter API key and secret first');
      return;
    }

    setConnectingTwitter(true);
    try {
      const result = await startTwitterConnect({
        data: {
          name: newName,
          account_type: newAccountType,
          apiKey: newTwitter.apiKey.trim(),
          apiSecret: newTwitter.apiSecret.trim(),
          premium: newTwitter.premium,
          origin: window.location.origin,
        },
      });
      window.location.assign(result.url);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Twitter connect failed';
      toast.error(message);
      setConnectingTwitter(false);
    }
  }

  async function handleMetaConnect() {
    setConnectingMeta(true);
    try {
      const result = await startMetaConnect({
        data: {
          origin: window.location.origin,
        },
      });
      window.location.assign(result.url);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Meta connect failed';
      toast.error(message);
      setConnectingMeta(false);
    }
  }

  async function handleLinkedInConnect() {
    setConnectingLinkedIn(true);
    try {
      const result = await startLinkedInConnect({ data: { origin: window.location.origin } });
      window.location.assign(result.url);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'LinkedIn connect failed';
      toast.error(message);
      setConnectingLinkedIn(false);
    }
  }

  async function handleRedditConnect() {
    setConnectingReddit(true);
    try {
      const result = await startRedditConnect({
        data: {
          origin: window.location.origin,
          defaultSubreddit: newReddit.defaultSubreddit,
        },
      });
      window.location.assign(result.url);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Reddit connect failed';
      toast.error(message);
      setConnectingReddit(false);
    }
  }

  async function handleYouTubeConnect() {
    setConnectingYouTube(true);
    try {
      const result = await startYouTubeConnect({
        data: {
          origin: window.location.origin,
          name: newName,
          account_type: newAccountType,
          privacyStatus: newYouTube.privacyStatus,
          notifySubscribers: newYouTube.notifySubscribers,
        },
      });
      window.location.assign(result.url);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'YouTube connect failed';
      toast.error(message);
      setConnectingYouTube(false);
    }
  }

  return (
    <div className="px-6 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/settings" className="text-muted-foreground hover:text-foreground transition-colors">
            <ChevronLeft className="w-4 h-4" />
          </Link>
          <h1 className="text-xl font-semibold">Channels</h1>
        </div>
        <Button size="sm" className="gap-1.5 text-xs" onClick={() => setAdding(true)} disabled={adding}>
          <Plus className="w-3.5 h-3.5" />
          Add channel
        </Button>
      </div>

      {adding && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">
              Name
              {(newPlatform === 'instagram' || newPlatform === 'facebook' || newPlatform === 'youtube' || newPlatform === 'reddit') && (
                <span className="text-muted-foreground"> (optional)</span>
              )}
            </Label>
            <Input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder={newPlatform === 'reddit' ? 'Filled from the connected Reddit user' : newPlatform === 'youtube' ? 'Optional override for the connected channel name' : 'e.g. Brand YouTube'}
              disabled={newPlatform === 'reddit'}
              className="text-sm h-8"
            />
          </div>

          <div className="flex gap-4">
            <div className="space-y-1.5 flex-1">
              <Label className="text-xs">Platform</Label>
              <div className="flex flex-wrap gap-2">
                {SUPPORTED_PLATFORMS.map(platform => (
                  <button
                    key={platform}
                    type="button"
                    onClick={() => setNewPlatform(platform)}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs transition-colors',
                      newPlatform === platform ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {platformIcon(platform)}
                    {PLATFORM_DEFINITIONS[platform].label}
                  </button>
                ))}
              </div>
            </div>

            {newPlatform === 'reddit' ? (
              <div className="flex-1 rounded-lg bg-muted/30 p-3 ring-1 ring-border">
                <p className="text-xs font-medium">Reddit user account</p>
                <p className="mt-1 text-xs text-muted-foreground text-pretty">
                  Reddit has no separate company-profile type. Sign in with the dedicated Userorbit account that should appear as the author.
                </p>
              </div>
            ) : (
              <div className="space-y-1.5 flex-1">
                <Label className="text-xs">Account Type</Label>
                <div className="flex gap-2">
                  {(['personal', 'company', 'page'] as AccountType[]).map(type => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setNewAccountType(type)}
                      className={cn(
                        'min-h-10 px-3 py-1.5 rounded-md border text-xs capitalize transition-colors active:scale-[0.96]',
                        newAccountType === type ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {newPlatform === 'twitter' ? (
            <TwitterForm fields={newTwitter} onChange={setNewTwitter} />
          ) : newPlatform === 'linkedin' ? (
            <LinkedInForm fields={newLinkedIn} onChange={setNewLinkedIn} />
          ) : newPlatform === 'reddit' ? (
            <RedditConnectForm fields={newReddit} onChange={setNewReddit} configured={availability.reddit} />
          ) : newPlatform === 'instagram' ? (
            <MetaConnectForm
              configured={availability.meta}
              title="Connect Meta once"
              description="Use the shared Meta app configured on the server. One authorization imports your Facebook Pages and any linked Instagram business accounts."
            />
          ) : newPlatform === 'facebook' ? (
            <MetaConnectForm
              configured={availability.meta}
              title="Connect Meta once"
              description="Use the shared Meta app configured on the server. One authorization imports your Facebook Pages and any linked Instagram business accounts."
            />
          ) : newPlatform === 'youtube' ? (
            <YouTubeConnectForm fields={newYouTube} onChange={setNewYouTube} configured={availability.youtube} />
          ) : newPlatform === 'discord' ? (
            <DiscordForm fields={newDiscord} onChange={setNewDiscord} />
          ) : null}

          <div className="flex gap-2">
            {newPlatform === 'twitter' ? (
              <>
                <Button size="sm" className="text-xs h-7" onClick={handleAdd} disabled={saving || !canCreate()}>
                  Create
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  className="text-xs h-7"
                  onClick={handleTwitterConnect}
                  disabled={connectingTwitter || !newTwitter.apiKey.trim() || !newTwitter.apiSecret.trim()}
                >
                  {connectingTwitter ? 'Connecting…' : 'Connect Twitter'}
                </Button>
              </>
            ) : newPlatform === 'linkedin' ? (
              <>
                <Button size="sm" className="text-xs h-7" onClick={handleAdd} disabled={saving || !canCreate()}>
                  Create manually
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  className="text-xs h-7"
                  onClick={handleLinkedInConnect}
                  disabled={connectingLinkedIn || !availability.linkedin}
                >
                  {connectingLinkedIn ? 'Connecting…' : 'Connect LinkedIn'}
                </Button>
              </>
            ) : newPlatform === 'reddit' ? (
              <Button
                size="sm"
                className="min-h-10 text-xs active:scale-[0.96] transition-transform"
                onClick={handleRedditConnect}
                disabled={connectingReddit || !availability.reddit || !newReddit.defaultSubreddit.trim()}
              >
                {connectingReddit ? 'Connecting…' : 'Connect Reddit'}
              </Button>
            ) : newPlatform === 'instagram' || newPlatform === 'facebook' ? (
              <Button
                size="sm"
                className="text-xs h-7"
                onClick={handleMetaConnect}
                disabled={connectingMeta || !availability.meta}
              >
                {connectingMeta ? 'Connecting…' : 'Connect Meta'}
              </Button>
            ) : newPlatform === 'youtube' ? (
              <Button
                size="sm"
                className="text-xs h-7"
                onClick={handleYouTubeConnect}
                disabled={connectingYouTube || !availability.youtube}
              >
                {connectingYouTube ? 'Connecting…' : 'Connect YouTube'}
              </Button>
            ) : (
              <Button size="sm" className="text-xs h-7" onClick={handleAdd} disabled={saving || !canCreate()}>
                Create
              </Button>
            )}
            <Button size="sm" variant="ghost" className="text-xs h-7" onClick={resetForm}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {channels.length === 0 && !adding && (
        <p className="text-sm text-muted-foreground py-8 text-center">No channels configured yet.</p>
      )}

      {SUPPORTED_PLATFORMS.map(platform => {
        const platformChannels = channels.filter(ch => ch.platform === platform);
        if (platformChannels.length === 0) return null;

        return (
          <div key={platform} className="space-y-3">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {PLATFORM_DEFINITIONS[platform].label}
            </h2>
            {platformChannels.map(channel => (
              <div key={channel.id} className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
                {platformIcon(channel.platform, 'w-4 h-4 flex-shrink-0')}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{channel.name}</p>
                  <p className="text-xs text-muted-foreground capitalize">
                    {channel.account_type}
                    {channel.is_default ? ' · Default' : ''}
                    {channel.platform === 'reddit' && channel.default_subreddit ? ` · r/${channel.default_subreddit}` : ''}
                  </p>
                </div>
                {!channel.is_default && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-xs h-7 text-muted-foreground hover:text-foreground"
                    onClick={async () => {
                      setSaving(true);
                      try {
                        await setDefaultChannel({ data: { id: channel.id } });
                        await refresh();
                      } finally {
                        setSaving(false);
                      }
                    }}
                    disabled={saving}
                  >
                    Make default
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-xs h-7 text-muted-foreground hover:text-destructive"
                  onClick={() => handleDelete(channel.id)}
                  disabled={deletingId === channel.id}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function RedditConnectForm({
  fields,
  onChange,
  configured,
}: {
  fields: RedditFields;
  onChange: (fields: RedditFields) => void;
  configured: boolean;
}) {
  return (
    <div className="space-y-3 rounded-lg bg-muted/30 p-3 ring-1 ring-border">
      <div className="space-y-1">
        <p className="text-sm font-medium text-balance">Connect the Reddit account that will publish</p>
        <p className="text-xs text-muted-foreground text-pretty">
          Reddit posts appear under the authorized username. The subreddit below becomes the default destination and can be changed per post.
        </p>
      </div>
      <div className="max-w-sm space-y-1.5">
        <Label htmlFor="reddit-default-subreddit" className="text-xs">Default subreddit</Label>
        <div className="flex items-center">
          <span className="flex h-10 items-center rounded-l-md border border-r-0 border-input bg-background px-3 text-sm text-muted-foreground">r/</span>
          <Input
            id="reddit-default-subreddit"
            value={fields.defaultSubreddit}
            onChange={event => onChange({ defaultSubreddit: event.target.value.replace(/^\/?r\//i, '') })}
            className="h-10 rounded-l-none text-sm"
            placeholder="Userorbit"
            autoComplete="off"
          />
        </div>
      </div>
      {!configured && (
        <p className="text-xs text-amber-600 text-pretty">
          Missing server setup. Add `REDDIT_CLIENT_ID` and `REDDIT_CLIENT_SECRET` after Reddit approves the app.
        </p>
      )}
    </div>
  );
}

function TwitterForm({ fields, onChange }: { fields: TwitterFields; onChange: (f: TwitterFields) => void }) {
  function patch(key: keyof TwitterFields, value: string | boolean) {
    onChange({ ...fields, [key]: value });
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">API Key</Label>
          <Input value={fields.apiKey} onChange={e => patch('apiKey', e.target.value)} className="text-sm h-8" type="password" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">API Secret</Label>
          <Input value={fields.apiSecret} onChange={e => patch('apiSecret', e.target.value)} className="text-sm h-8" type="password" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Access Token</Label>
          <Input value={fields.accessToken} onChange={e => patch('accessToken', e.target.value)} className="text-sm h-8" type="password" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Access Token Secret</Label>
          <Input value={fields.accessTokenSecret} onChange={e => patch('accessTokenSecret', e.target.value)} className="text-sm h-8" type="password" />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox id="premium" checked={fields.premium} onCheckedChange={value => patch('premium', Boolean(value))} />
        <Label htmlFor="premium" className="text-xs cursor-pointer">Premium account (4,000 char limit)</Label>
      </div>
      <p className="text-xs text-muted-foreground">Add tokens manually to create the channel now, or use Connect Twitter to fill them from OAuth.</p>
    </div>
  );
}

function LinkedInForm({ fields, onChange }: { fields: LinkedInFields; onChange: (f: LinkedInFields) => void }) {
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Access Token</Label>
        <Input value={fields.accessToken} onChange={e => onChange({ ...fields, accessToken: e.target.value })} className="text-sm h-8" type="password" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Organization ID <span className="text-muted-foreground">(leave blank for personal profile)</span></Label>
        <Input value={fields.orgId} onChange={e => onChange({ ...fields, orgId: e.target.value })} className="text-sm h-8" placeholder="e.g. 12345678" />
      </div>
    </div>
  );
}

function MetaConnectForm({ configured, title, description }: { configured: boolean; title: string; description: string }) {
  return (
    <div className="space-y-3">
      <div className="rounded-md border border-border bg-muted/30 px-3 py-3 space-y-1.5">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
        {!configured && (
          <p className="text-xs text-amber-600">
            Missing server setup. Add `META_APP_ID` and `META_APP_SECRET` once in the deployment environment.
          </p>
        )}
      </div>
    </div>
  );
}

function YouTubeConnectForm({
  fields,
  onChange,
  configured,
}: {
  fields: YouTubeFields;
  onChange: (f: YouTubeFields) => void;
  configured: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="rounded-md border border-border bg-muted/30 px-3 py-3 space-y-1.5">
        <p className="text-sm font-medium">Connect YouTube once</p>
        <p className="text-xs text-muted-foreground">
          Use the shared Google OAuth app configured on the server. The callback stores upload credentials for this channel automatically.
        </p>
        {!configured && (
          <p className="text-xs text-amber-600">
            Missing server setup. Add `YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET` once in the deployment environment.
          </p>
        )}
      </div>
      <div className="flex gap-3">
        <div className="space-y-1.5 flex-1">
          <Label className="text-xs">Privacy</Label>
          <Select value={fields.privacyStatus} onValueChange={value => onChange({ ...fields, privacyStatus: value as YouTubeFields['privacyStatus'] })}>
            <SelectTrigger className="h-8 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="private">Private</SelectItem>
              <SelectItem value="unlisted">Unlisted</SelectItem>
              <SelectItem value="public">Public</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end pb-1">
          <div className="flex items-center gap-2">
            <Checkbox
              id="youtube-notify"
              checked={fields.notifySubscribers}
              onCheckedChange={value => onChange({ ...fields, notifySubscribers: Boolean(value) })}
            />
            <Label htmlFor="youtube-notify" className="text-xs cursor-pointer">Notify subscribers</Label>
          </div>
        </div>
      </div>
    </div>
  );
}

function DiscordForm({ fields, onChange }: { fields: DiscordFields; onChange: (f: DiscordFields) => void }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Checkbox id="useWebhook" checked={fields.useWebhook} onCheckedChange={value => onChange({ ...fields, useWebhook: Boolean(value) })} />
        <Label htmlFor="useWebhook" className="text-xs cursor-pointer">Use Webhook URL (easier setup)</Label>
      </div>

      {fields.useWebhook ? (
        <div className="space-y-1.5">
          <Label className="text-xs">Webhook URL</Label>
          <Input
            value={fields.webhookUrl}
            onChange={e => onChange({ ...fields, webhookUrl: e.target.value })}
            className="text-sm h-8"
            type="password"
            placeholder="https://discord.com/api/webhooks/..."
          />
          <p className="text-xs text-muted-foreground">Get this from your Discord channel → Integrations → Webhooks</p>
        </div>
      ) : (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs">Bot Token</Label>
            <Input value={fields.botToken} onChange={e => onChange({ ...fields, botToken: e.target.value })} className="text-sm h-8" type="password" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Channel ID</Label>
            <Input value={fields.channelId} onChange={e => onChange({ ...fields, channelId: e.target.value })} className="text-sm h-8" placeholder="e.g. 1234567890123456789" />
          </div>
        </>
      )}
    </div>
  );
}
