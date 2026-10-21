// ABOUTME: Renders a platform-specific or simple post preview card.
// ABOUTME: Supports socialflow-style simple card (avatar, name, now) or Twitter/LinkedIn cards.

import { cn } from '@/lib/utils';
import { SimplePreviewCard } from './SimplePreviewCard';
import { htmlToText } from '@/lib/text';
import type { UploadedMedia } from './MediaUpload';
import type { PlatformId } from '@/lib/platforms';

type Platform = PlatformId;

interface PostPreviewProps {
  platform: Platform;
  content: string;
  thread?: string[];
  platforms: Platform[];
  onPlatformChange: (p: Platform) => void;
  /** 'simple' = socialflow-style (avatar + name + now); 'platform' = Twitter/LinkedIn cards */
  variant?: 'simple' | 'platform';
  authorName?: string;
  media?: UploadedMedia[];
  /** Map of platform → published post ID (tweet ID or LinkedIn URN) */
  publishedIds?: Partial<Record<Platform, string | null>>;
  [key: string]: unknown;
}

export function PostPreview(props: PostPreviewProps) {
  const {
    platform,
    content,
    thread = [],
    variant = 'simple',
    authorName = 'Admin',
    media = [],
  } = props;
  const text = htmlToText(content);

  return (
    <div className="flex flex-col h-full border-l border-border">
      <div className="flex-1 overflow-y-auto p-2 flex items-start justify-center">
        {variant === 'simple' ? (
          <SimplePreviewCard
            authorName={authorName}
            content={content}
            thread={thread}
            media={media}
            className="max-w-md min-w-[320px] min-h-60 mt-12"
          />
        ) : platform === 'twitter' ? (
          <div className="space-y-0 w-full max-w-sm">
            <TwitterCard text={text} />
            {thread.filter(Boolean).map((item, i) => (
              <div key={i} className="flex gap-0">
                <div className="flex flex-col items-center ml-5">
                  <div className="w-px flex-1 bg-border" />
                </div>
                <div className="flex-1 pt-1">
                  <TwitterCard text={htmlToText(item)} isReply />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-0 w-full max-w-sm">
            <LinkedInCard text={text} />
            {thread.filter(Boolean).map((item, i) => (
              <div key={i} className="flex gap-0">
                <div className="flex flex-col items-center ml-6">
                  <div className="w-px flex-1 bg-border" />
                </div>
                <div className="flex-1 pt-1">
                  <LinkedInCommentCard text={htmlToText(item)} index={i} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TwitterCard({ text, isReply = false }: { text: string; isReply?: boolean }) {
  return (
    <div className={cn('rounded-2xl border border-border bg-card p-4', isReply && 'rounded-tl-none border-t-0')}>
      <div className="flex gap-3">
        <div className="w-10 h-10 rounded-full bg-muted shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-1.5 flex-wrap">
            <span className="font-bold text-sm">Your Name</span>
            <span className="text-xs text-muted-foreground">@handle</span>
            <span className="text-xs text-muted-foreground">· now</span>
          </div>
          {text ? (
            <p className="mt-1.5 text-sm whitespace-pre-wrap break-words">{text}</p>
          ) : (
            <p className="mt-1.5 text-sm text-muted-foreground italic">No content yet…</p>
          )}
          <div className="flex items-center gap-6 mt-3 text-muted-foreground text-xs">
            <span>💬 Reply</span>
            <span>🔁 Repost</span>
            <span>❤️ Like</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function LinkedInCard({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex gap-3 mb-3">
        <div className="w-12 h-12 rounded-full bg-muted shrink-0" />
        <div>
          <p className="font-semibold text-sm">Your Name</p>
          <p className="text-xs text-muted-foreground">Your Headline</p>
          <p className="text-xs text-muted-foreground">Just now · 🌐</p>
        </div>
      </div>
      {text ? (
        <p className="text-sm whitespace-pre-wrap break-words">{text}</p>
      ) : (
        <p className="text-sm text-muted-foreground italic">No content yet…</p>
      )}
      <div className="flex items-center gap-4 mt-4 pt-3 border-t border-border text-muted-foreground text-xs">
        <span>👍 Like</span>
        <span>💬 Comment</span>
        <span>🔁 Repost</span>
        <span>✉️ Send</span>
      </div>
    </div>
  );
}

function LinkedInCommentCard({ text, index }: { text: string; index: number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3 ml-2">
      <div className="flex gap-2 mb-2">
        <div className="w-8 h-8 rounded-full bg-muted shrink-0" />
        <div>
          <p className="font-semibold text-xs">Your Name</p>
          <p className="text-xs text-muted-foreground">Just now</p>
        </div>
      </div>
      {text ? (
        <p className="text-xs whitespace-pre-wrap break-words">{text}</p>
      ) : (
        <p className="text-xs text-muted-foreground italic">Comment {index + 1}…</p>
      )}
    </div>
  );
}
