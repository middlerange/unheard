// ABOUTME: Compact post card shown inside calendar day cells and list views.
// ABOUTME: Shows platform badges, state indicator, truncated content, and idea/template context.

import { Twitter, Linkedin, Instagram, Facebook, Youtube, Clock, CheckCircle2, AlertCircle, FileText, ExternalLink, Lightbulb, LayoutTemplate, ShieldCheck } from "@/components/icons";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { htmlToText } from '@/lib/text';
import type { PostWithDetails } from '@/lib/db/types';

const STATE_STYLES: Record<string, string> = {
  draft: 'bg-[var(--color-bg-subtle)] border-border',
  scheduled: 'bg-[rgba(0,122,231,0.08)] border-[rgba(0,122,231,0.25)]',
  awaiting_approval: 'bg-[rgba(139,92,246,0.08)] border-[rgba(139,92,246,0.25)]',
  publishing: 'bg-[rgba(139,92,246,0.08)] border-[rgba(139,92,246,0.25)]',
  published: 'bg-[rgba(34,197,94,0.08)] border-[rgba(34,197,94,0.25)]',
  failed: 'bg-[rgba(232,93,93,0.08)] border-[rgba(232,93,93,0.25)]',
};

const STATE_ICONS: Record<string, React.ReactNode> = {
  draft: <FileText className="w-3 h-3 text-muted-foreground" />,
  scheduled: <Clock className="w-3 h-3 text-blue-400" />,
  awaiting_approval: <ShieldCheck className="w-3 h-3 text-violet-500" />,
  publishing: <ShieldCheck className="w-3 h-3 text-violet-500" />,
  published: <CheckCircle2 className="w-3 h-3 text-green-400" />,
};

interface PostCardProps {
  post: PostWithDetails;
  onClick: () => void;
  compact?: boolean;
}

function platformUrl(platform: string, platformPostId: string): string {
  if (platform === 'twitter') return `https://x.com/i/web/status/${platformPostId}`;
  if (platform === 'linkedin') return `https://www.linkedin.com/feed/update/${platformPostId}/`;
  if (platform === 'youtube') return `https://www.youtube.com/watch?v=${platformPostId}`;
  if (platform === 'facebook') return `https://www.facebook.com/${platformPostId}`;
  return '#';
}

function platformIcon(platform: string): React.ReactNode {
  switch (platform) {
    case 'twitter':
      return <Twitter className="w-3 h-3 text-[#1d9bf0]" />;
    case 'linkedin':
      return <Linkedin className="w-3 h-3 text-[#0a66c2]" />;
    case 'instagram':
      return <Instagram className="w-3 h-3 text-[#E4405F]" />;
    case 'facebook':
      return <Facebook className="w-3 h-3 text-[#1877F2]" />;
    case 'youtube':
      return <Youtube className="w-3 h-3 text-[#FF0000]" />;
    default:
      return <FileText className="w-3 h-3 text-muted-foreground" />;
  }
}

export function PostCard({ post, onClick, compact = false }: PostCardProps) {
  const rawContent = post.targets[0]?.content ?? '';
  const content = htmlToText(rawContent);
  const errors = post.targets.filter(t => t.error).map(t => `${t.channel_name ?? t.platform}: ${t.error}`).join(' · ');

  const stateIcon = post.state === 'failed' && errors ? (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <AlertCircle className="w-3 h-3 text-red-400" />
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs">{errors}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ) : post.state === 'failed' ? (
    <AlertCircle className="w-3 h-3 text-red-400" />
  ) : (
    STATE_ICONS[post.state]
  );

  const hasContext = !compact && (post.template_name || post.writing_prompt || post.idea_text);

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left rounded border px-2 py-1.5 transition-colors hover:bg-[var(--color-bg-muted)] cursor-pointer',
        STATE_STYLES[post.state] ?? STATE_STYLES.draft,
      )}
    >
      <div className="flex items-center gap-1 mb-0.5">
        {stateIcon}
        <div className="flex items-center gap-1 ml-auto">
          {post.targets.map(t => {
            const icon = platformIcon(t.platform);
            if (t.platform_post_id) {
              return (
                <a
                  key={t.id}
                  href={platformUrl(t.platform, t.platform_post_id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={e => e.stopPropagation()}
                  className="flex items-center gap-0.5 hover:opacity-70"
                >
                  {icon}
                  {t.channel_name ? <span className="text-[10px] text-muted-foreground">{t.channel_name}</span> : null}
                  <ExternalLink className="w-2.5 h-2.5 text-muted-foreground" />
                </a>
              );
            }
            return <span key={t.id} className="flex items-center gap-0.5">{icon}{t.channel_name ? <span className="text-[10px] text-muted-foreground">{t.channel_name}</span> : null}</span>;
          })}
        </div>
      </div>
      {!compact && (
        <p className="text-xs text-foreground/80 line-clamp-2 leading-relaxed">{content || '(no content)'}</p>
      )}
      {hasContext && (
        <div className="mt-1.5 flex flex-col gap-0.5">
          {post.template_name && (
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <LayoutTemplate className="w-2.5 h-2.5 shrink-0" />
              <span className="truncate">{post.template_name}</span>
            </div>
          )}
          {post.writing_prompt && (
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Lightbulb className="w-2.5 h-2.5 shrink-0 text-yellow-400" />
              <span className="truncate">{post.writing_prompt}</span>
            </div>
          )}
          {post.idea_text && !post.writing_prompt && (
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Lightbulb className="w-2.5 h-2.5 shrink-0 text-yellow-400" />
              <span className="truncate">{post.idea_text}</span>
            </div>
          )}
        </div>
      )}
    </button>
  );
}
