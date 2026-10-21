// ABOUTME: Standalone post editor with multi-account support.
// ABOUTME: Updated for flexible account management - multiple Twitter, LinkedIn, Reddit accounts.

'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Twitter, Linkedin, Instagram, Facebook, Youtube, CalendarClock, Send, FileText, Loader2, Trash2, Settings, Sparkles, ExternalLink, LayoutTemplate, Lightbulb, AlertCircle, Plus, ShieldCheck, AudioLines } from "@/components/icons";
import { RedditLogo } from '@/components/RedditLogo';
import { Skeleton } from '@/components/ui/skeleton';
import dayjs from 'dayjs';
import { ChannelAvatar } from '@/components/ChannelAvatar';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { htmlToText, normalizeEditorContent, splitIntoTweetChunks } from '@/lib/text';
import { ThreadEditor } from './ThreadEditor';
import { AssistantChat } from '@/components/ai/AssistantChat';
import { PostPreview } from './PostPreview';
import { TwitterSettings } from './TwitterSettings';
import { LinkedInSettings } from './LinkedInSettings';
import { DiscordSettings } from './DiscordSettings';
import { RedditSettings, type RedditSettingsValue } from './RedditSettings';
import { MediaUpload, type UploadedMedia } from './MediaUpload';
import { createPost, updatePost, publishNow } from '@/app/server-fns/posts';
import { getChannels, getTwitterLimit, type ChannelView } from '@/app/server-fns/channels';
import { getBrands } from '@/app/server-fns/brands';
import { cn } from '@/lib/utils';
import type { BrandProfile, PostWithDetails } from '@/lib/db/types';
import { PLATFORM_DEFINITIONS, type PlatformId } from '@/lib/platforms';
import { validateMultiPlatformPost, type MultiPlatformPost, type ValidationError } from '@/lib/validation';
import { resolvePostMedia } from '@/lib/post-media';
import { useDashboardHeader } from '@/lib/dashboard-header-context';

const DEFAULT_TWITTER_LIMIT = 280;
const LINKEDIN_LIMIT = 3000;

type Platform = PlatformId;

interface PlatformContent {
  content: string;
  thread: string[];
  reply_settings: string;
  as_carousel: boolean;
  carousel_name: string;
  // Discord-specific
  thread_name?: string;
  reddit_title: string;
  subreddit: string;
  reddit_post_type: 'self' | 'link';
  reddit_url: string;
  flair_id: string;
  nsfw: boolean;
  spoiler: boolean;
}

interface BrandVoicePreview {
  brand: { id: string; name: string };
  targets: Array<{ platform: 'linkedin' | 'twitter'; content: string; thread: string[] }>;
}

function defaultPlatformContent(): PlatformContent {
  return {
    content: '',
    thread: [],
    reply_settings: 'everyone',
    as_carousel: false,
    carousel_name: '',
    thread_name: '',
    reddit_title: '',
    subreddit: '',
    reddit_post_type: 'self',
    reddit_url: '',
    flair_id: '',
    nsfw: false,
    spoiler: false,
  };
}

function defaultPlatform(platforms: Platform[]): Platform {
  if (platforms.includes('linkedin')) return 'linkedin';
  if (platforms.includes('twitter')) return 'twitter';
  if (platforms.includes('instagram')) return 'instagram';
  if (platforms.includes('facebook')) return 'facebook';
  if (platforms.includes('youtube')) return 'youtube';
  if (platforms.includes('reddit')) return 'reddit';
  if (platforms.includes('discord')) return 'discord';
  return 'linkedin';
}

function platformAccentClass(platform: Platform): string {
  switch (platform) {
    case 'twitter':
      return 'bg-black text-white';
    case 'linkedin':
      return 'bg-[#0a66c2] text-white';
    case 'instagram':
      return 'bg-[#E4405F] text-white';
    case 'facebook':
      return 'bg-[#1877F2] text-white';
    case 'youtube':
      return 'bg-[#FF0000] text-white';
    case 'reddit':
      return 'bg-[#FF4500] text-white';
    default:
      return 'bg-muted text-foreground';
  }
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

function getAccountTypeLabel(accountType?: string): string {
  switch (accountType) {
    case 'personal': return 'Personal';
    case 'company': return 'Company';
    case 'page': return 'Page';
    default: return 'Account';
  }
}

function publishedTargetUrl(platform: Platform, postId: string): string | null {
  switch (platform) {
    case 'twitter':
      return `https://x.com/i/status/${postId}`;
    case 'linkedin':
      return `https://www.linkedin.com/feed/update/${postId}`;
    case 'youtube':
      return `https://www.youtube.com/watch?v=${postId}`;
    case 'facebook':
      return `https://www.facebook.com/${postId}`;
    case 'reddit':
      return postId.startsWith('http') ? postId : `https://reddit.com/${postId}`;
    default:
      return null;
  }
}

export interface PostEditorViewProps {
  onSaved: () => void;
  onDelete?: () => void;
  initialDate?: Date;
  existing?: PostWithDetails;
  initialPrompt?: string;
}

export function PostEditorView({ onSaved, onDelete, initialDate, existing, initialPrompt }: PostEditorViewProps) {
  // All connected channels
  const [channels, setChannels] = useState<ChannelView[]>([]);
  const [isLoadingChannels, setIsLoadingChannels] = useState(true);
  const [brands, setBrands] = useState<BrandProfile[]>([]);
  const [brandId, setBrandId] = useState(existing?.brand_id ?? '');
   
  // Selected channel IDs
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>(() =>
    existing?.targets.map(target => target.channel_id).filter((value): value is string => Boolean(value)) ?? []
  );

  // Platform-specific content settings
  const [perPlatform, setPerPlatform] = useState<Record<Platform, PlatformContent>>(() => {
    const base: Record<Platform, PlatformContent> = {
      twitter: defaultPlatformContent(),
      linkedin: defaultPlatformContent(),
      instagram: defaultPlatformContent(),
      facebook: defaultPlatformContent(),
      youtube: defaultPlatformContent(),
      reddit: defaultPlatformContent(),
      discord: defaultPlatformContent(),
      telegram: defaultPlatformContent(),
    };
    if (existing) {
      for (const t of existing.targets) {
        base[t.platform as Platform] = {
          content: t.content,
          thread: t.thread ?? [],
          reply_settings: t.reply_settings ?? 'everyone',
          as_carousel: Boolean(t.as_carousel),
          carousel_name: t.carousel_name ?? '',
          reddit_title: t.reddit_title ?? '',
          subreddit: t.subreddit ?? '',
          reddit_post_type: t.reddit_post_type ?? 'self',
          reddit_url: t.reddit_url ?? '',
          flair_id: t.flair_id ?? '',
          nsfw: Boolean(t.nsfw),
          spoiler: Boolean(t.spoiler),
        };
      }
    }
    return base;
  });

  // Global content (used when "same content for all" is enabled)
  const [useGlobal, setUseGlobal] = useState(!existing);
  const [globalContent, setGlobalContent] = useState(existing?.targets[0]?.content ?? '');
  const [globalThread, setGlobalThread] = useState<string[]>(existing?.targets[0]?.thread ?? []);
  
  // Active platform tab
  const [activePlatform, setActivePlatform] = useState<Platform>(() => {
    const existingPlatforms = existing?.targets.map(t => t.platform as Platform) ?? ['twitter', 'linkedin'];
    return defaultPlatform(existingPlatforms);
  });
  
  const [media, setMedia] = useState<UploadedMedia[]>(() => {
    if (!existing?.media?.length) return [];
    return existing.media.filter(m => m.target_id == null);
  });
  
  // Per-platform media attachments
  const [perPlatformMedia, setPerPlatformMedia] = useState<Record<Platform, UploadedMedia[]>>(() => {
    const base: Record<Platform, UploadedMedia[]> = {
      twitter: [],
      linkedin: [],
      instagram: [],
      facebook: [],
      youtube: [],
      reddit: [],
      discord: [],
      telegram: [],
    };
    if (existing) {
      // Group existing media by target platform
      for (const target of existing.targets) {
        const targetMedia = existing.media?.filter(m => m.target_id === target.id) ?? [];
        base[target.platform as Platform] = targetMedia;
      }
    }
    return base;
  });
  
  // Scheduling
  const [scheduleDate, setScheduleDate] = useState<Date | null>(initialDate ?? null);
  const [scheduleDatetimeLocal, setScheduleDatetimeLocal] = useState(() =>
    (initialDate ? dayjs(initialDate) : dayjs().add(1, 'hour').startOf('minute')).format('YYYY-MM-DDTHH:mm')
  );
  
  // UI state
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showAssistant, setShowAssistant] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [showValidationErrors, setShowValidationErrors] = useState(false);
  const [brandPreview, setBrandPreview] = useState<BrandVoicePreview | null>(null);
  const [brandPreviewOpen, setBrandPreviewOpen] = useState(false);
  const [previewPlatform, setPreviewPlatform] = useState<'linkedin' | 'twitter'>('linkedin');
  const [previewingBrandId, setPreviewingBrandId] = useState<string | null>(null);
  const [brandPreviewError, setBrandPreviewError] = useState<string | null>(null);
  const { setActions } = useDashboardHeader();
  
  // Twitter character limit (varies by account premium status)
  const [twitterLimit, setTwitterLimit] = useState<number>(DEFAULT_TWITTER_LIMIT);

  // Group channels by platform for display
  const channelsByPlatform = useMemo(() => {
    const grouped = new Map<Platform, ChannelView[]>();
    for (const channel of channels) {
      const platform = channel.platform as Platform;
      if (!grouped.has(platform)) {
        grouped.set(platform, []);
      }
      grouped.get(platform)!.push(channel);
    }
    return grouped;
  }, [channels]);

  // Available platforms with connected accounts
  const availablePlatforms = useMemo(() => {
    return Array.from(channelsByPlatform.keys()).sort();
  }, [channelsByPlatform]);

  // Selected channels
  const selectedChannels = useMemo(() => {
    return channels.filter(channel => selectedChannelIds.includes(channel.id));
  }, [channels, selectedChannelIds]);

  const redditChannel = useMemo(
    () => selectedChannels.find(channel => channel.platform === 'reddit'),
    [selectedChannels],
  );

  const redditSettingsValue = useMemo<RedditSettingsValue>(() => ({
    title: perPlatform.reddit.reddit_title,
    subreddit: perPlatform.reddit.subreddit || redditChannel?.default_subreddit || '',
    postType: perPlatform.reddit.reddit_post_type,
    url: perPlatform.reddit.reddit_url,
    flairId: perPlatform.reddit.flair_id,
    nsfw: perPlatform.reddit.nsfw,
    spoiler: perPlatform.reddit.spoiler,
  }), [perPlatform.reddit, redditChannel?.default_subreddit]);

  // Active platforms from selected channels
  const platforms = useMemo<Platform[]>(() => {
    const activePlatforms = new Set(selectedChannels.map(channel => channel.platform as Platform));
    return Array.from(activePlatforms).sort();
  }, [selectedChannels]);

  const effectiveContent = useCallback((p: Platform) =>
    useGlobal ? globalContent : perPlatform[p].content,
    [useGlobal, globalContent, perPlatform]
  );

  const effectiveThread = useCallback((p: Platform) =>
    useGlobal ? globalThread : perPlatform[p].thread,
    [useGlobal, globalThread, perPlatform]
  );

  const effectiveMedia = useCallback((p: Platform) => {
    if (p === 'reddit') return [];
    if (useGlobal) return media;
    return resolvePostMedia(media, perPlatformMedia[p] ?? []);
  }, [useGlobal, media, perPlatformMedia]);

  // Validation errors
  const validationPosts: MultiPlatformPost[] = useMemo(() => {
    return selectedChannels.map(channel => {
      const content = effectiveContent(channel.platform as Platform);
      const thread = effectiveThread(channel.platform as Platform);
      const channelMedia = effectiveMedia(channel.platform as Platform);
      const isTwitter = channel.platform === 'twitter';
      const isPremium = isTwitter && twitterLimit > 280;
      
        return {
          platform: channel.platform,
          content: htmlToText(content),
          thread: thread.map(t => htmlToText(t)).filter(Boolean),
          media: channelMedia.map(m => ({ id: m.id, post_id: '', target_id: null, filename: m.filename, path: m.path, url: m.url, type: m.type })),
          asCarousel: perPlatform[channel.platform as Platform]?.as_carousel,
          isPremium,
        };
    });
  }, [selectedChannels, globalContent, globalThread, media, perPlatformMedia, perPlatform, twitterLimit, useGlobal]);

  const validationErrors: ValidationError[] = useMemo(() => {
    if (platforms.length === 0) return [];
    const errors = validateMultiPlatformPost(validationPosts);
    if (platforms.includes('reddit')) {
      const subreddit = redditSettingsValue.subreddit;
      if (!redditSettingsValue.title.trim()) {
        errors.push({ field: 'reddit_title', platform: 'reddit', message: 'Add a Reddit title.' });
      }
      if (!/^[A-Za-z0-9_]{2,100}$/.test(subreddit.replace(/^\/?r\//i, ''))) {
        errors.push({ field: 'subreddit', platform: 'reddit', message: 'Add a valid subreddit.' });
      }
      if (redditSettingsValue.postType === 'link') {
        try {
          new URL(redditSettingsValue.url);
        } catch {
          errors.push({ field: 'reddit_url', platform: 'reddit', message: 'Add a valid article URL for the link post.' });
        }
      }
    }
    return errors;
  }, [validationPosts, platforms, redditSettingsValue]);

  const hasValidationErrors = validationErrors.length > 0;

  const twitterValidationErrors = useMemo(() => 
    validationErrors.filter(e => e.platform === 'twitter'),
    [validationErrors]
  );

  const linkedinValidationErrors = useMemo(() => 
    validationErrors.filter(e => e.platform === 'linkedin'),
    [validationErrors]
  );

  const discordValidationErrors = useMemo(() => 
    validationErrors.filter(e => e.platform === 'discord'),
    [validationErrors]
  );

  // Fetch all channels on mount
  useEffect(() => {
    let cancelled = false;

    setIsLoadingChannels(true);
    getChannels()
      .then(result => {
        if (cancelled) return;
        setChannels(result);
        setIsLoadingChannels(false);
      })
      .catch(() => {
        if (cancelled) return;
        setChannels([]);
        setIsLoadingChannels(false);
      });

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getBrands()
      .then(result => {
        if (!cancelled) setBrands(result);
      })
      .catch(() => {
        if (!cancelled) setBrands([]);
      });
    return () => { cancelled = true; };
  }, []);

  // Initialize selected channels from existing post or defaults
  useEffect(() => {
    if (channels.length === 0 || selectedChannelIds.length > 0) return;

    if (existing) {
      // Restore channels from existing post
      const restoredIds = existing.targets
        .map(target => {
          if (target.channel_id) return target.channel_id;
          // Fallback: find channel by platform
          return channels.find(channel => 
            channel.platform === target.platform && channel.is_default
          )?.id ?? channels.find(channel => 
            channel.platform === target.platform
          )?.id ?? null;
        })
        .filter((value): value is string => Boolean(value));

      if (restoredIds.length > 0) {
        setSelectedChannelIds(Array.from(new Set(restoredIds)));
        return;
      }
    }

    // Default: select default channels (one per platform)
    const defaultChannels = channels.filter(channel => channel.is_default);
    if (defaultChannels.length > 0) {
      setSelectedChannelIds(defaultChannels.map(c => c.id));
      return;
    }

    // Fallback: select first channel of each platform
    const firstPerPlatform = new Map<Platform, string>();
    for (const channel of channels) {
      const platform = channel.platform as Platform;
      if (!firstPerPlatform.has(platform)) {
        firstPerPlatform.set(platform, channel.id);
      }
    }
    setSelectedChannelIds(Array.from(firstPerPlatform.values()));
  }, [channels, selectedChannelIds.length, existing]);

  // Remove invalid selections when channels change
  useEffect(() => {
    setSelectedChannelIds(prev => 
      prev.filter(id => channels.some(channel => channel.id === id))
    );
  }, [channels]);

  // Update active platform when platforms change
  useEffect(() => {
    setActivePlatform(prev => (platforms.includes(prev) ? prev : defaultPlatform(platforms)));
  }, [platforms]);

  // Fetch Twitter character limits for selected Twitter accounts
  useEffect(() => {
    let cancelled = false;

    const twitterChannels = selectedChannels.filter(channel => channel.platform === 'twitter');
    
    if (twitterChannels.length === 0) {
      setTwitterLimit(DEFAULT_TWITTER_LIMIT);
      return;
    }

    Promise.all(
      twitterChannels.map(channel => 
        getTwitterLimit({ data: { channel_id: channel.id } })
      )
    ).then(results => {
      if (cancelled) return;
      const minLimit = Math.min(...results.map(r => r?.limit ?? DEFAULT_TWITTER_LIMIT));
      setTwitterLimit(minLimit);
    }).catch(() => {
      if (cancelled) return;
      setTwitterLimit(DEFAULT_TWITTER_LIMIT);
    });

    return () => { cancelled = true; };
  }, [selectedChannels]);

  function updateContent(p: Platform, value: string) {
    if (useGlobal) {
      setGlobalContent(value);
    } else {
      setPerPlatform(prev => ({ ...prev, [p]: { ...prev[p], content: value } }));
    }
  }

  function updateThread(p: Platform, items: string[]) {
    if (useGlobal) {
      setGlobalThread(items);
    } else {
      setPerPlatform(prev => ({ ...prev, [p]: { ...prev[p], thread: items } }));
    }
  }

  function updateSettings(p: Platform, patch: Partial<PlatformContent>) {
    setPerPlatform(prev => ({ ...prev, [p]: { ...prev[p], ...patch } }));
  }

  function updateRedditSettings(patch: Partial<RedditSettingsValue>) {
    setPerPlatform(prev => ({
      ...prev,
      reddit: {
        ...prev.reddit,
        ...(patch.title !== undefined ? { reddit_title: patch.title } : {}),
        ...(patch.subreddit !== undefined ? { subreddit: patch.subreddit } : {}),
        ...(patch.postType !== undefined ? { reddit_post_type: patch.postType } : {}),
        ...(patch.url !== undefined ? { reddit_url: patch.url } : {}),
        ...(patch.flairId !== undefined ? { flair_id: patch.flairId } : {}),
        ...(patch.nsfw !== undefined ? { nsfw: patch.nsfw } : {}),
        ...(patch.spoiler !== undefined ? { spoiler: patch.spoiler } : {}),
      },
    }));
  }

  function toggleChannel(channelId: string) {
    setSelectedChannelIds(prev => {
      if (prev.includes(channelId)) {
        // Don't allow deselecting the last channel
        if (prev.length === 1) return prev;
        return prev.filter(id => id !== channelId);
      }
      return [...prev, channelId];
    });
  }

  function buildTargets() {
    return selectedChannels.map(channel => {
      const content = effectiveContent(channel.platform as Platform);
      const thread = effectiveThread(channel.platform as Platform).filter(Boolean);

      const isTwitter = channel.platform === 'twitter';
      const mergedContent = !isTwitter && useGlobal && thread.length > 0
        ? normalizeEditorContent([content, ...thread].map(item => htmlToText(item).trim()).filter(Boolean).join('\n\n'))
        : content;

      return {
        channel_id: channel.id,
        platform: channel.platform,
        content: mergedContent,
        thread: isTwitter || !useGlobal ? thread : [],
        reply_settings: perPlatform[channel.platform as Platform].reply_settings,
        as_carousel: perPlatform[channel.platform as Platform].as_carousel,
        carousel_name: perPlatform[channel.platform as Platform].carousel_name || undefined,
        reddit_title: channel.platform === 'reddit' ? perPlatform.reddit.reddit_title.trim() : undefined,
        subreddit: channel.platform === 'reddit'
          ? (perPlatform.reddit.subreddit || channel.default_subreddit || '').replace(/^\/?r\//i, '')
          : undefined,
        reddit_post_type: channel.platform === 'reddit' ? perPlatform.reddit.reddit_post_type : undefined,
        reddit_url: channel.platform === 'reddit' && perPlatform.reddit.reddit_post_type === 'link'
          ? perPlatform.reddit.reddit_url.trim()
          : undefined,
        flair_id: channel.platform === 'reddit' ? perPlatform.reddit.flair_id || undefined : undefined,
        nsfw: channel.platform === 'reddit' ? perPlatform.reddit.nsfw : undefined,
        spoiler: channel.platform === 'reddit' ? perPlatform.reddit.spoiler : undefined,
      };
    });
  }

  function updateMedia(p: Platform, items: UploadedMedia[]) {
    if (useGlobal) {
      setMedia(items);
    } else {
      setPerPlatformMedia(prev => ({ ...prev, [p]: items }));
    }
  }

  function buildMedia() {
    const sharedMedia = media.map(m => ({
      id: m.id,
      filename: m.filename,
      path: m.path,
      url: m.url,
      type: m.type,
      target_id: null as string | null,
    }));

    if (useGlobal) return sharedMedia;

    const targetSpecificMedia = selectedChannels.flatMap(channel => {
      const platform = channel.platform as Platform;
      const platformMedia = perPlatformMedia[platform] || [];
      return platformMedia
        .filter(m => !sharedMedia.some(s => s.id === m.id))
        .map(m => ({
          id: m.id,
          filename: m.filename,
          path: m.path,
          url: m.url,
          type: m.type,
          target_id: channel.id,
        }));
    });

    return [...sharedMedia, ...targetSpecificMedia];
  }

  function buildExistingMeta() {
    const selectedBrand = brands.find(brand => brand.id === brandId);
    return {
      idea_id: existing?.idea_id ?? undefined,
      template_id: existing?.template_id ?? undefined,
      brand_id: brandId || undefined,
      writing_prompt: selectedBrand?.writing_prompt ?? existing?.writing_prompt ?? undefined,
    };
  }

  async function handlePreviewBrand(nextBrandId: string) {
    if (!existing || nextBrandId === brandId) return;

    const sourcePlatform: Platform = existing.targets.some(target => target.platform === 'linkedin')
      ? 'linkedin'
      : currentPlatform;
    const sourceText = [
      htmlToText(effectiveContent(sourcePlatform)),
      ...effectiveThread(sourcePlatform).map(htmlToText),
    ].filter(Boolean).join('\n\n').trim();
    if (!sourceText) return;

    setBrandPreview(null);
    setBrandPreviewError(null);
    setPreviewingBrandId(nextBrandId);
    setBrandPreviewOpen(true);

    try {
      const response = await fetch('/api/ideas/convert-to-post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ideaId: existing.idea_id ?? undefined,
          sourceText: existing.idea_id ? undefined : sourceText,
          templateId: existing.template_id ?? undefined,
          brandId: nextBrandId,
          previewOnly: true,
        }),
      });
      const result = await response.json() as BrandVoicePreview & { error?: string };
      if (!response.ok || !result.brand) {
        throw new Error(result.error || 'Failed to preview this brand voice');
      }
      setBrandPreview(result);
      setPreviewPlatform(result.targets.some(target => target.platform === currentPlatform)
        ? currentPlatform as 'linkedin' | 'twitter'
        : 'linkedin');
    } catch (error) {
      setBrandPreviewError(error instanceof Error ? error.message : 'Failed to preview this brand voice');
    } finally {
      setPreviewingBrandId(null);
    }
  }

  function applyBrandPreview() {
    if (!brandPreview) return;
    setUseGlobal(false);
    setPerPlatform(previous => {
      const next = { ...previous };
      for (const target of brandPreview.targets) {
        next[target.platform] = {
          ...next[target.platform],
          content: normalizeEditorContent(target.content),
          thread: target.thread.map(normalizeEditorContent),
        };
      }
      return next;
    });
    setBrandId(brandPreview.brand.id);
    setBrandPreviewOpen(false);
  }

  async function handleSaveDraft() {
    if (platforms.length === 0) return;
    if (hasValidationErrors) {
      setShowValidationErrors(true);
      return;
    }
    setSaving(true);
    setPublishError(null);
    try {
      const input = { 
        targets: buildTargets(), 
        media: buildMedia(), 
        state: 'draft' as const, 
        publish_at: null, 
        channel_group: null, // No longer using hardcoded groups
        ...buildExistingMeta() 
      };
      if (existing) await updatePost({ data: { ...input, id: existing.id } });
      else await createPost({ data: input });
      onSaved();
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : 'Failed to save draft');
    } finally {
      setSaving(false);
    }
  }

  async function handleSchedule(date?: Date | null) {
    const toUse = date ?? scheduleDate;
    if (!toUse || platforms.length === 0) return;
    if (hasValidationErrors) {
      setShowValidationErrors(true);
      return;
    }
    setSaving(true);
    setPublishError(null);
    try {
      const input = { 
        targets: buildTargets(), 
        media: buildMedia(), 
        state: 'scheduled' as const, 
        publish_at: toUse.getTime(), 
        channel_group: null,
        ...buildExistingMeta() 
      };
      if (existing) await updatePost({ data: { ...input, id: existing.id } });
      else await createPost({ data: input });
      onSaved();
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : 'Failed to schedule post');
    } finally {
      setSaving(false);
    }
  }

  async function handlePostNow() {
    if (platforms.length === 0) return;
    if (hasValidationErrors) {
      setShowValidationErrors(true);
      return;
    }
    setSaving(true);
    setPublishError(null);
    try {
      const result = await publishNow({ 
        data: { 
          targets: buildTargets(), 
          media: buildMedia(), 
          state: 'scheduled' as const, 
          publish_at: null, 
          channel_group: null,
          ...buildExistingMeta() 
        } 
      });
      if (result?.state === 'failed') {
        const msgs = result.targets.filter(t => t.error).map(t => `${t.channel_name ?? t.platform}: ${t.error}`);
        setPublishError(msgs.length ? msgs.join(' · ') : 'Approval request failed');
      } else {
        onSaved();
      }
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : 'Approval request failed');
    } finally {
      setSaving(false);
    }
  }

  const displayPlatforms: Platform[] = platforms.length > 0 ? platforms : availablePlatforms.length > 0 ? availablePlatforms : ['twitter'];
  const currentPlatform: Platform = displayPlatforms.includes(activePlatform) ? activePlatform : defaultPlatform(displayPlatforms);
  const showPlatformTabs = !useGlobal && platforms.length > 1;
  
  const storedError = existing?.state === 'failed'
    ? existing.targets.filter(t => t.error).map(t => `${t.channel_name ?? t.platform}: ${t.error}`).join(' · ') || 'Publishing failed'
    : null;

  useEffect(() => {
    setActions(
      <div className="flex items-center gap-2">
        {existing?.state === 'published' && selectedChannels.map(channel => {
          const target = existing.targets.find(t => t.channel_id === channel.id);
          if (!target?.platform_post_id) return null;
          const url = publishedTargetUrl(channel.platform as Platform, target.platform_post_id);
          if (!url) return null;

          return (
            <a
              key={channel.id}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border border-border bg-background hover:bg-muted transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              View {channel.name}
            </a>
          );
        })}
        <span className="text-sm font-semibold text-foreground">Preview</span>
        <Button
          variant="secondary"
          size="xs"
          onClick={() => setShowAssistant(v => !v)}
          aria-label={showAssistant ? 'Hide AI assistant' : 'Show AI assistant'}
        >
          <Sparkles className="w-3.5 h-3.5" />
        </Button>
      </div>
    );

    return () => {
      setActions(null);
    };
  }, [existing, selectedChannels, setActions, showAssistant]);

  const hasChanges = useMemo(() => {
    if (!existing) return true;
    if (brandId !== (existing.brand_id ?? '')) return true;
    const existingChannels = existing.targets.map(t => t.channel_id).filter((value): value is string => Boolean(value)).sort();
    const currentChannels = [...selectedChannelIds].sort();
    if (currentChannels.length !== existingChannels.length || currentChannels.some((id, i) => id !== existingChannels[i])) return true;
    for (const p of platforms) {
      const target = existing.targets.find(t => t.platform === p);
      if (!target) return true;
      if (effectiveContent(p) !== target.content) return true;
      const curThread = effectiveThread(p);
      const origThread = target.thread ?? [];
      if (curThread.length !== origThread.length || curThread.some((t, i) => t !== origThread[i])) return true;
      if (perPlatform[p].reply_settings !== (target.reply_settings ?? 'everyone')) return true;
      if (perPlatform[p].as_carousel !== Boolean(target.as_carousel)) return true;
      if ((perPlatform[p].carousel_name || '') !== (target.carousel_name ?? '')) return true;
      if (p === 'reddit') {
        if (perPlatform.reddit.reddit_title !== (target.reddit_title ?? '')) return true;
        if (redditSettingsValue.subreddit !== (target.subreddit ?? '')) return true;
        if (perPlatform.reddit.reddit_post_type !== (target.reddit_post_type ?? 'self')) return true;
        if (perPlatform.reddit.reddit_url !== (target.reddit_url ?? '')) return true;
        if (perPlatform.reddit.flair_id !== (target.flair_id ?? '')) return true;
        if (perPlatform.reddit.nsfw !== Boolean(target.nsfw)) return true;
        if (perPlatform.reddit.spoiler !== Boolean(target.spoiler)) return true;
      }
    }
    // Check shared media
    const origSharedMedia = existing.media?.filter(m => m.target_id === null) ?? [];
    if (media.length !== origSharedMedia.length || media.some((m, i) => m.id !== origSharedMedia[i]?.id)) return true;
    // Check per-platform media
    for (const p of platforms) {
      const origTargetMedia = existing.media?.filter(m => {
        const target = existing.targets.find(t => t.platform === p && m.target_id === t.id);
        return !!target;
      }) ?? [];
      const curTargetMedia = perPlatformMedia[p] ?? [];
      if (curTargetMedia.length !== origTargetMedia.length) return true;
      if (curTargetMedia.some((m, i) => m.id !== origTargetMedia[i]?.id)) return true;
    }
    return false;
  }, [existing, brandId, selectedChannelIds, platforms, effectiveContent, effectiveThread, perPlatform, media, perPlatformMedia, redditSettingsValue.subreddit]);

  return (
    <div className="flex h-full overflow-hidden flex-1">
      {/* Main editor + preview + footer */}
      <div className="flex flex-col flex-1 min-w-0">
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Edit column */}
          <div className="flex flex-col min-w-[320px] w-auto flex-1 shrink-0">
            {existing?.state === 'scheduled' && existing.publish_at && (
              <div className="px-5 py-2 border-b border-border bg-[var(--color-bg-subtle)] flex items-center gap-2">
                <CalendarClock className="w-3.5 h-3.5 text-blue-500" />
                <p className="text-xs text-muted-foreground">
                  Scheduled for{' '}
                  <span className="font-medium text-foreground">
                    {dayjs(existing.publish_at).format('MMM D, YYYY h:mm A')}
                  </span>
                </p>
              </div>
            )}
            {(existing?.state === 'awaiting_approval' || existing?.state === 'publishing') && (
              <div className="px-5 py-2 border-b border-violet-200 bg-violet-50 flex items-center gap-2">
                <ShieldCheck className="w-3.5 h-3.5 text-violet-600" />
                <p className="text-xs text-violet-800">
                  {existing.state === 'publishing'
                    ? 'Telegram approval received. Publishing the approved snapshot now.'
                    : 'Waiting for Telegram approval. Nothing will publish until the preview is approved.'}
                </p>
              </div>
            )}

            {/* Idea / template context banner */}
            {existing && (brands.length > 0 || existing.brand_id || existing.template_name || existing.writing_prompt || existing.idea_text) && (
              <div className="flex flex-wrap items-start gap-x-4 gap-y-1 px-5 py-2 border-b border-border bg-[var(--color-bg-subtle)]">
                {brands.length > 0 && (
                  <Select value={brandId} onValueChange={handlePreviewBrand} disabled={Boolean(previewingBrandId)}>
                    <SelectTrigger
                      size="sm"
                      className="h-10 max-w-[240px] border-0 bg-background px-2.5 shadow-sm transition-[box-shadow,transform] active:scale-[0.96]"
                      aria-label="Preview post in another brand voice"
                    >
                      {previewingBrandId ? (
                        <Loader2 className="size-3.5 animate-spin text-[var(--color-brand)]" />
                      ) : (
                        <AudioLines className="size-3.5 text-[var(--color-brand)]" />
                      )}
                      <span className="text-xs text-muted-foreground">Voice</span>
                      <SelectValue placeholder="Not recorded" />
                    </SelectTrigger>
                    <SelectContent align="start" className="min-w-[240px]">
                      {brands.map(brand => (
                        <SelectItem key={brand.id} value={brand.id} className="py-2.5 text-xs">
                          <span className="font-medium text-foreground">{brand.name}</span>
                          {brand.is_default && <span className="text-muted-foreground">Default</span>}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {existing.template_name && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <LayoutTemplate className="w-3.5 h-3.5 shrink-0" />
                    <span className="font-medium text-foreground">{existing.template_name}</span>
                  </div>
                )}
                {existing.writing_prompt && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground min-w-0">
                    <Lightbulb className="w-3.5 h-3.5 shrink-0 text-yellow-400" />
                    <span className="truncate" title={existing.writing_prompt}>{existing.writing_prompt}</span>
                  </div>
                )}
                {existing.idea_text && !existing.writing_prompt && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground min-w-0">
                    <Lightbulb className="w-3.5 h-3.5 shrink-0 text-yellow-400" />
                    <span className="truncate" title={existing.idea_text}>{existing.idea_text}</span>
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-col gap-4 p-5 overflow-y-auto flex-1">
              {/* Channels Section */}
              <div>
                {isLoadingChannels ? (
                  <div className="flex min-h-[76px] items-center justify-center gap-2 rounded-lg border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
                    <Skeleton className="size-4 rounded-full" />
                    Loading connected accounts...
                  </div>
                ) : availablePlatforms.length === 0 ? (
                  <div className="rounded-md border border-border bg-muted/20 p-4 text-center">
                    <p className="text-sm text-muted-foreground">No accounts connected</p>
                    <Button variant="link" size="sm" className="mt-1" asChild>
                      <a href="/settings/channels">Connect accounts →</a>
                    </Button>
                  </div>
                ) : (
                  <TooltipProvider>
                    <div className="flex flex-wrap gap-2 items-center">
                      {channels.map(channel => {
                        const isSelected = selectedChannelIds.includes(channel.id);
                        const platform = channel.platform as Platform;
                        const hasError = validationErrors.some(error => error.platform === platform);
                        return (
                          <Tooltip key={channel.id}>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                onClick={() => toggleChannel(channel.id)}
                                className={cn(
                                  'relative rounded-full transition-all outline-none',
                                  isSelected
                                    ? 'ring-2 ring-offset-1 ring-foreground/40'
                                    : 'opacity-40 hover:opacity-70'
                                )}
                              >
                                <img
                                  src="/dp.jpeg"
                                  alt={channel.name}
                                  className="w-10 h-10 rounded-full object-cover"
                                />
                                <span
                                  className={cn(
                                    'absolute -bottom-0.5 -right-0.5 flex items-center justify-center w-4 h-4 rounded-full',
                                    platformAccentClass(platform)
                                  )}
                                >
                                  {platformIcon(platform, 'w-2.5 h-2.5')}
                                </span>
                                {hasError && isSelected && (
                                  <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-destructive rounded-full border border-background" />
                                )}
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom">
                              <p className="text-xs font-medium">{channel.name}</p>
                              {channel.account_id && <p className="text-xs opacity-70">@{channel.account_id}</p>}
                            </TooltipContent>
                          </Tooltip>
                        );
                      })}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Link
                            to="/settings/channels"
                            search={{
                              twitter_connected: undefined,
                              twitter_error: undefined,
                              linkedin_connected: undefined,
                              linkedin_profile: undefined,
                              linkedin_error: undefined,
                              reddit_connected: undefined,
                              reddit_username: undefined,
                              reddit_error: undefined,
                              meta_connected: undefined,
                              meta_summary: undefined,
                              meta_error: undefined,
                              youtube_connected: undefined,
                              youtube_channel: undefined,
                              youtube_error: undefined,
                            }}
                            className="w-10 h-10 rounded-full border-2 border-dashed border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
                          >
                            <Plus className="w-4 h-4" />
                          </Link>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                          <p className="text-xs">Add account</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </TooltipProvider>
                )}
              </div>

              {showAdvanced && (
                <div className="space-y-3">
                  {platforms.length > 1 && (
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="global-toggle"
                        checked={useGlobal}
                        onCheckedChange={v => setUseGlobal(Boolean(v))}
                      />
                      <Label htmlFor="global-toggle" className="text-xs text-muted-foreground cursor-pointer">
                        Same content for all platforms
                      </Label>
                    </div>
                  )}
                  {platforms.includes('twitter') && (
                    <TwitterSettings
                      replySettings={perPlatform.twitter.reply_settings}
                      onChange={v => updateSettings('twitter', { reply_settings: v })}
                    />
                  )}
                  {platforms.includes('linkedin') && (
                    <LinkedInSettings
                      asCarousel={perPlatform.linkedin.as_carousel}
                      carouselName={perPlatform.linkedin.carousel_name}
                      onChange={patch => updateSettings('linkedin', patch)}
                    />
                  )}
                  {platforms.includes('discord') && (
                    <DiscordSettings
                      threadName={perPlatform.discord.thread_name}
                      onChange={patch => updateSettings('discord', { thread_name: patch.threadName })}
                    />
                  )}
                </div>
              )}

              {/* Validation Errors Alert */}
              {showValidationErrors && hasValidationErrors && (
                <Alert variant="destructive" className="text-xs">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="ml-2">
                    <div className="font-medium mb-1">Please fix the following issues:</div>
                    <ul className="list-disc pl-4 space-y-0.5">
                      {validationErrors.map((error, i) => (
                        <li key={i}>
                          <span className="font-medium">{error.platform}:</span> {error.message}
                        </li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              {/* Editor card */}
              <div className="rounded-lg bg-card p-4 shadow-sm ring-1 ring-[var(--color-ring-elevated)] space-y-3">
                {useGlobal ? (
                  <>
                    {platforms.includes('reddit') && (
                      <RedditSettings
                        value={redditSettingsValue}
                        channelId={redditChannel?.id}
                        onChange={updateRedditSettings}
                      />
                    )}
                    <ThreadEditor
                      content={globalContent}
                      thread={globalThread}
                      onChange={setGlobalContent}
                      onThreadChange={setGlobalThread}
                      maxChars={platforms.length > 0
                        ? Math.min(...platforms.map(p =>
                            p === 'twitter' ? twitterLimit :
                            p === 'linkedin' ? LINKEDIN_LIMIT :
                            p === 'instagram' ? 2200 :
                            p === 'youtube' ? 5000 :
                            p === 'facebook' ? 63206 :
                            40000
                          ))
                        : LINKEDIN_LIMIT}
                      platform={platforms.length === 1 ? platforms[0] : undefined}
                    />
                  </>
                ) : (
                  <div className="space-y-3">
                    {showPlatformTabs && (
                      <div className="flex gap-1 border-b border-border">
                        {displayPlatforms.map(p => (
                          <button
                            key={p}
                            type="button"
                            onClick={() => setActivePlatform(p)}
                          className={cn(
                              'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border-b-2 -mb-px transition-colors',
                              currentPlatform === p ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
                            )}
                          >
                            {platformIcon(p)}
                            {PLATFORM_DEFINITIONS[p].label}
                            {validationErrors.some(error => error.platform === p) && (
                              <span className="ml-1 w-2 h-2 bg-destructive rounded-full" />
                            )}
                          </button>
                        ))}
                      </div>
                    )}

                    {displayPlatforms.map(p => (
                      <div key={p} className={p !== currentPlatform ? 'hidden' : ''}>
                        {p === 'reddit' && (
                          <RedditSettings
                            value={redditSettingsValue}
                            channelId={redditChannel?.id}
                            onChange={updateRedditSettings}
                          />
                        )}
                        <ThreadEditor
                          content={perPlatform[p].content}
                          thread={perPlatform[p].thread}
                          onChange={v => updateContent(p, v)}
                          onThreadChange={items => updateThread(p, items)}
                          maxChars={
                            p === 'twitter' ? twitterLimit :
                            p === 'linkedin' ? LINKEDIN_LIMIT :
                            p === 'instagram' ? 2200 :
                            p === 'youtube' ? 5000 :
                            p === 'facebook' ? 63206 :
                            p === 'discord' ? 2000 :
                            40000
                          }
                          platform={p}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Media upload - show shared media when global, per-platform when not */}
              {useGlobal ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Media (shared across all platforms)</span>
                    {media.length > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {media.length} item{media.length !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  <MediaUpload media={media} onChange={setMedia} />
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="rounded-md border border-border bg-card p-3">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-medium">Shared media</p>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">
                          Used on platforms without their own media.
                        </p>
                      </div>
                      {media.length > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {media.length} item{media.length !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    <MediaUpload media={media} onChange={setMedia} />
                  </div>

                  <div className="rounded-md border border-border bg-card p-3">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-xs font-medium">Platform-specific media</span>
                      {showPlatformTabs && (
                        <div className="flex gap-1 ml-auto">
                          {displayPlatforms.map(p => (
                            <button
                              key={p}
                              type="button"
                              onClick={() => setActivePlatform(p)}
                              className={cn(
                                'flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded transition-colors',
                                currentPlatform === p ? 'bg-primary/10 text-[var(--color-brand)]' : 'text-muted-foreground hover:text-foreground',
                              )}
                            >
                              {platformIcon(p)}
                               {PLATFORM_DEFINITIONS[p].label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    
                    {displayPlatforms.map(p => (
                      <div key={p} className={p !== currentPlatform ? 'hidden' : ''}>
                        <div className="space-y-2">
                          <MediaUpload 
                            media={perPlatformMedia[p] || []} 
                            onChange={items => updateMedia(p, items)} 
                          />
                          {media.length > 0 && (
                            <p className="text-[10px] text-muted-foreground mt-2">
                              {(perPlatformMedia[p]?.length ?? 0) > 0
                                ? 'This platform’s media replaces the shared media in its preview and published post.'
                                : 'Using the shared media shown above in this preview and published post.'}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>{/* end edit column */}

          <div className="flex-1 w-auto shrink-0 min-w-[320px] overflow-hidden">
            <PostPreview
              platform={currentPlatform}
              content={effectiveContent(currentPlatform)}
              thread={effectiveThread(currentPlatform)}
              platforms={displayPlatforms}
              onPlatformChange={setActivePlatform}
              media={effectiveMedia(currentPlatform)}
              publishedIds={existing?.state === 'published' ? Object.fromEntries(existing.targets.map(t => [t.platform, t.platform_post_id])) : undefined}
            />
          </div>
        </div>{/* end columns wrapper */}

        {/* Footer — editor controls */}
        <div className="flex flex-col gap-2 px-5 py-2 border-t border-border bg-[var(--color-bg-subtle)]">
          {(publishError ?? storedError) && (
            <p className="text-xs text-destructive text-right">{publishError ?? storedError}</p>
          )}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {existing && onDelete && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onDelete}
                  disabled={saving}
                  className="text-xs gap-1.5 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete
                </Button>
              )}
              <button
                type="button"
                onClick={() => setShowAdvanced(v => !v)}
                className={cn(
                  'p-1.5 rounded-md transition-colors text-xs flex items-center gap-1',
                  showAdvanced ? 'text-foreground bg-muted' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Settings className="w-3.5 h-3.5" />
                Advanced
              </button>
            </div>

            <div className="flex items-center gap-2">
              <Button 
                variant="secondary" 
                size="sm" 
                onClick={handleSaveDraft} 
                disabled={saving || platforms.length === 0 || (!!hasValidationErrors && showValidationErrors)}
                title={hasValidationErrors ? 'Fix validation errors before saving' : undefined}
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <FileText className="w-3.5 h-3.5 mr-1.5" />}
                Save
              </Button>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={saving || platforms.length === 0 || (!!hasValidationErrors && showValidationErrors)}
                    title={hasValidationErrors ? 'Fix validation errors before scheduling' : undefined}
                  >
                    {saving ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <CalendarClock className="w-3.5 h-3.5 mr-1.5" />}
                    Schedule
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-80">
                  <div className="flex flex-col gap-2">
                    <p className="text-sm font-medium">Schedule</p>
                    <Input
                      type="datetime-local"
                      value={scheduleDatetimeLocal}
                      onChange={e => setScheduleDatetimeLocal(e.target.value)}
                      min={dayjs().format('YYYY-MM-DDTHH:mm')}
                      className="text-sm"
                    />
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        const d = new Date(scheduleDatetimeLocal);
                        if (Number.isFinite(d.getTime())) {
                          setScheduleDate(d);
                          handleSchedule(d);
                        }
                      }}
                      disabled={saving || platforms.length === 0 || hasValidationErrors}
                    >
                      {saving ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null}
                      Schedule post
                    </Button>
                    {hasValidationErrors && (
                      <p className="text-xs text-destructive">Fix validation errors before scheduling</p>
                    )}
                  </div>
                </PopoverContent>
              </Popover>
              <Button 
                size="sm" 
                onClick={handlePostNow} 
                disabled={saving || platforms.length === 0 || (!!hasValidationErrors && showValidationErrors)}
                title={hasValidationErrors ? 'Fix validation errors before requesting approval' : undefined}
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Send className="w-3.5 h-3.5 mr-1.5" />}
                Request approval
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* AI chat — full height beside editor */}
      {showAssistant && (
        <div className="w-[340px] shrink-0 border-l border-border flex flex-col overflow-hidden">
          <AssistantChat
            currentContent={useGlobal ? globalContent : perPlatform[currentPlatform]?.content}
            onApplyBrand={setBrandId}
            onApplyTwitterContent={(content, thread) => {
              const shouldFlattenTwitter = currentPlatform === 'twitter' && twitterLimit > 280;
              const mergedContent = shouldFlattenTwitter
                ? [content, ...thread].filter(Boolean).join('\n\n')
                : content;
              const mergedThread = shouldFlattenTwitter ? [] : thread;
              const html = normalizeEditorContent(mergedContent);
              const htmlThread = mergedThread.map(t => normalizeEditorContent(t));
              if (useGlobal) {
                setGlobalContent(html);
                setGlobalThread(htmlThread);
              } else {
                setPerPlatform(prev => ({
                  ...prev,
                  [currentPlatform]: { ...prev[currentPlatform], content: html, thread: htmlThread },
                }));
              }
            }}
            onAddMedia={item => setMedia(prev => [...prev, item])}
            className="flex-1 overflow-hidden"
          />
        </div>
      )}

      <Dialog open={brandPreviewOpen} onOpenChange={setBrandPreviewOpen}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Preview another brand voice</DialogTitle>
            <DialogDescription>
              Same idea and outline, rewritten in {brandPreview?.brand.name ?? brands.find(brand => brand.id === previewingBrandId)?.name ?? 'the selected voice'}. Your post will not change until you apply it.
            </DialogDescription>
          </DialogHeader>

          {previewingBrandId && (
            <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
              <Loader2 className="size-5 animate-spin text-[var(--color-brand)]" />
              Generating voice preview…
            </div>
          )}

          {brandPreviewError && (
            <Alert variant="destructive">
              <AlertCircle className="size-4" />
              <AlertDescription>{brandPreviewError}</AlertDescription>
            </Alert>
          )}

          {brandPreview && (
            <div className="space-y-4">
              <div className="flex gap-1 border-b border-border">
                {brandPreview.targets.map(target => (
                  <button
                    key={target.platform}
                    type="button"
                    onClick={() => setPreviewPlatform(target.platform)}
                    className={cn(
                      'flex min-h-10 items-center gap-1.5 border-b-2 px-3 text-xs font-medium transition-colors',
                      previewPlatform === target.platform
                        ? 'border-primary text-foreground'
                        : 'border-transparent text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {platformIcon(target.platform)}
                    {PLATFORM_DEFINITIONS[target.platform].label}
                  </button>
                ))}
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-xl bg-[var(--color-bg-subtle)] p-4 shadow-sm ring-1 ring-[var(--color-ring-elevated)]">
                  <p className="mb-3 text-xs font-semibold text-muted-foreground">Current · {brands.find(brand => brand.id === brandId)?.name ?? existing?.brand_name ?? 'Voice not recorded'}</p>
                  <p className="max-h-[360px] overflow-y-auto whitespace-pre-wrap text-sm leading-6 text-foreground [text-wrap:pretty]">
                    {[htmlToText(effectiveContent(previewPlatform)), ...effectiveThread(previewPlatform).map(htmlToText)].filter(Boolean).join('\n\n')}
                  </p>
                </div>
                <div className="rounded-xl bg-card p-4 shadow-sm ring-1 ring-primary/20">
                  <p className="mb-3 text-xs font-semibold text-[var(--color-brand)]">Preview · {brandPreview.brand.name}</p>
                  <p className="max-h-[360px] overflow-y-auto whitespace-pre-wrap text-sm leading-6 text-foreground [text-wrap:pretty]">
                    {(() => {
                      const target = brandPreview.targets.find(item => item.platform === previewPlatform);
                      return target ? [target.content, ...target.thread].filter(Boolean).join('\n\n') : '';
                    })()}
                  </p>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setBrandPreviewOpen(false)}>
              Keep current
            </Button>
            <Button type="button" onClick={applyBrandPreview} disabled={!brandPreview}>
              <Sparkles className="size-4" />
              Use this voice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
