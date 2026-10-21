// ABOUTME: Simple post preview card (socialflow-style).
// ABOUTME: Avatar + author name + "now" + content in a single card.

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { htmlToText } from '@/lib/text';
import type { UploadedMedia } from './MediaUpload';

function renderInlineMarkdown(line: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const regex = /\*\*(.+?)\*\*|\*(.+?)\*/g;
  let last = 0;
  let match;
  let key = 0;
  while ((match = regex.exec(line)) !== null) {
    if (match.index > last) parts.push(line.slice(last, match.index));
    if (match[1] !== undefined) parts.push(<strong key={key++}>{match[1]}</strong>);
    else if (match[2] !== undefined) parts.push(<em key={key++}>{match[2]}</em>);
    last = match.index + match[0].length;
  }
  if (last < line.length) parts.push(line.slice(last));
  return parts;
}

function MarkdownParagraph({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <p className="whitespace-pre-wrap">
      {lines.map((line, i) => (
        <span key={i}>
          {i > 0 && '\n'}
          {renderInlineMarkdown(line)}
        </span>
      ))}
    </p>
  );
}

interface SimplePreviewCardProps {
  authorName?: string;
  content: string;
  thread?: string[];
  media?: UploadedMedia[];
  className?: string;
}

export function SimplePreviewCard({
  authorName = 'Admin',
  content,
  thread = [],
  media = [],
  className,
}: SimplePreviewCardProps) {
  const text = htmlToText(content);
  const initial = authorName.slice(0, 1).toUpperCase();
  const threadItems = thread.filter(Boolean);

  return (
    <div className={cn('space-y-0', className)}>
      <div className="rounded-xl bg-card p-4 shadow-sm ring-1 ring-[var(--color-ring-elevated)]">
        <div className="flex items-center gap-3">
          <div
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-[var(--color-brand)]"
            aria-hidden
          >
            {initial}
          </div>
          <div className="min-w-0">
            <p className="truncate font-semibold text-sm">{authorName}</p>
            <p className="text-sm text-muted-foreground">now</p>
          </div>
        </div>
        <div className="post-copy mt-3 text-foreground break-words">
          {text ? (
            text.split(/\n\n+/).map((para, i) => (
              <MarkdownParagraph key={i} text={para} />
            ))
          ) : (
            <span className="text-muted-foreground italic">Your post preview…</span>
          )}
        </div>
        {media.length > 0 && (
          <div className={cn('mt-3 grid gap-1', media.length === 1 ? 'grid-cols-1' : 'grid-cols-2')}>
            {media.map(m => (
              m.type === 'image' ? (
                <img key={m.id} src={m.url} alt={m.filename} className="w-full rounded-lg object-cover aspect-video" />
              ) : (
                <video key={m.id} src={m.url} className="w-full rounded-lg object-cover aspect-video" controls />
              )
            ))}
          </div>
        )}
      </div>

      {threadItems.map((item, i) => (
        <div key={i} className="flex">
          <div className="flex flex-col items-center ml-5 shrink-0">
            <div className="w-px flex-1 bg-border min-h-[8px]" />
          </div>
          <div className="flex-1 pl-2 pt-1 pb-1">
            <div className="rounded-xl border border-border bg-card p-3 shadow-sm ring-1 ring-[var(--color-ring-elevated)]">
              <div className="flex items-center gap-2 mb-2">
                <div
                  className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-[var(--color-brand)]"
                  aria-hidden
                >
                  {initial}
                </div>
                <div className="min-w-0">
                  <p className="truncate font-semibold text-xs">{authorName}</p>
                </div>
              </div>
              <div className="post-copy text-foreground break-words">
                {htmlToText(item).split(/\n\n+/).map((para, j) => (
                  <MarkdownParagraph key={j} text={para} />
                ))}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
