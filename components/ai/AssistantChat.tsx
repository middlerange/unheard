// ABOUTME: Chat-based AI assistant UI powered by TanStack AI useChat hook.
// ABOUTME: Supports tool results (Twitter conversion, cover image suggestions/generation) with action buttons.

'use client';

import { useRef, useEffect, useMemo, useState } from 'react';
import { useChat, fetchServerSentEvents } from '@tanstack/ai-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Twitter, Check, ArrowUp, Image, Sparkles, Copy, ExternalLink, CalendarClock, Plus, Wrench, Mic } from "@/components/icons";
import { cn } from '@/lib/utils';
import { BrailleSpinner } from '@/components/ui/braille-spinner';
import { getBrands } from '@/app/server-fns/brands';
import { getTemplates } from '@/app/server-fns/templates';
import type { BrandProfile, Template } from '@/lib/db/types';
import type { UploadedMedia } from '@/components/post-modal/MediaUpload';

interface AssistantChatProps {
  currentContent?: string;
  onApplyTwitterContent: (content: string, thread: string[]) => void;
  onApplyBrand?: (brandId: string) => void;
  onAddMedia?: (media: UploadedMedia) => void;
  className?: string;
}

export function AssistantChat({ currentContent, onApplyTwitterContent, onApplyBrand, onAddMedia, className }: AssistantChatProps) {
  const [input, setInput] = useState('');
  const [brands, setBrands] = useState<BrandProfile[]>([]);
  const [brandId, setBrandId] = useState<string>('');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState<string>('auto');
  const [writingPrompt, setWritingPrompt] = useState('');
  const [appliedParts, setAppliedParts] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const connection = useMemo(() => fetchServerSentEvents('/api/assistant'), []);

  useEffect(() => {
    getBrands().then(list => {
      setBrands(list);
      const def = list.find(b => b.is_default) ?? list[0];
      if (def) setBrandId(def.id);
    });
    getTemplates().then(setTemplates).catch(() => {});
  }, []);

  const body = useMemo(() => ({
    ...(brandId ? { brandId } : {}),
    ...(templateId !== 'auto' ? { templateId } : {}),
    ...(templateId === 'freeform' && writingPrompt.trim() ? { writingPrompt: writingPrompt.trim() } : {}),
    ...(currentContent?.trim() ? { postContent: currentContent } : {}),
  }), [brandId, templateId, writingPrompt, currentContent]);

  const { messages, sendMessage, isLoading } = useChat({
    connection,
    body,
  });

  const toolCallIdToName = useMemo(() => {
    const map = new Map<string, string>();
    for (const msg of messages) {
      for (const part of msg.parts) {
        if (part.type === 'tool-call') {
          map.set((part as any).id, (part as any).name);
        }
      }
    }
    return map;
  }, [messages]);

  const completedToolCallIds = useMemo(() => {
    const ids = new Set<string>();
    for (const msg of messages) {
      for (const part of msg.parts) {
        if (part.type === 'tool-result') {
          ids.add(part.toolCallId);
        }
      }
    }
    return ids;
  }, [messages]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    sendMessage(input.trim());
    setInput('');
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit(e);
    }
  }

  function handleSuggestCoverImages() {
    if (!currentContent?.trim() || isLoading) return;
    sendMessage(`Suggest cover image ideas for this post:\n\n${currentContent}`);
  }

  function handleGenerateImage(title: string, prompt: string) {
    sendMessage(`Generate the cover image: "${title}" — ${prompt}`);
  }

  function applyContent(content: string, thread: string[]) {
    onApplyTwitterContent(content, thread);
    if (brandId) onApplyBrand?.(brandId);
  }

  return (
    <div className={cn('flex flex-col h-full', className)}>
      <div className="px-4 py-2 h-[49px] border-b border-border flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-yellow-400" />
        <p className="text-sm font-medium">Chat</p>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-xs text-muted-foreground text-center py-8">
            Ask me to help with your posts, or use a quick action below.
          </div>
        )}

        {messages.map(msg => (
          <div key={msg.id} className={cn('flex flex-col gap-1', msg.role === 'user' ? 'items-end' : 'items-start')}>
            {msg.parts.map((part, i) => {
              if (part.type === 'text' && part.content) {
                return (
                  <div
                    key={i}
                    className={cn(
                      'text-xs rounded-lg px-3 py-2 max-w-[90%] whitespace-pre-wrap',
                      msg.role === 'user'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-foreground',
                    )}
                  >
                    {part.content}
                  </div>
                );
              }

              if (part.type === 'tool-call') {
                if (completedToolCallIds.has((part as any).id)) return null;
                const toolName = (part as any).name;
                const label = toolName === 'generateCoverImage'
                  ? 'Generating image...'
                  : toolName === 'suggestCoverImages'
                    ? 'Coming up with ideas...'
                    : toolName === 'schedulePost'
                      ? 'Scheduling post...'
                    : 'Working...';
                return (
                  <div key={i} className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <BrailleSpinner className="text-xs" />
                    {label}
                  </div>
                );
              }

              if (part.type === 'tool-result') {
                const toolName = toolCallIdToName.get(part.toolCallId);

                if (toolName === 'suggestPosts') {
                  const data = safeParseJSON(part.content) as { suggestions?: unknown; error?: unknown } | null;
                  const suggestions = Array.isArray(data?.suggestions) ? data.suggestions : [];
                  if (suggestions.length === 0) {
                    const error = typeof data?.error === 'string' ? data.error : 'No suggestions returned.';
                    return <ToolErrorCard key={i} message={error} />;
                  }
                  const partKey = `${msg.id}:${i}`;
                  return (
                    <SuggestedPostsCard
                      key={i}
                      suggestions={suggestions as PostSuggestion[]}
                      appliedKey={appliedParts.has(partKey) ? partKey : null}
                      onApply={(content, thread, suggestionIndex) => {
                        applyContent(content, thread);
                        setAppliedParts(prev => new Set(prev).add(partKey));
                      }}
                    />
                  );
                }

                if (toolName === 'suggestCoverImages') {
                  const data = safeParseJSON(part.content) as { suggestions?: unknown } | null;
                  const suggestions = Array.isArray(data?.suggestions) ? data.suggestions : [];
                  if (suggestions.length === 0) {
                    return <ToolErrorCard key={i} message="No image ideas returned." />;
                  }
                  return (
                    <ImageSuggestionsCard
                      key={i}
                      suggestions={suggestions as ImageSuggestion[]}
                      onGenerate={handleGenerateImage}
                      disabled={isLoading}
                    />
                  );
                }

                if (toolName === 'generateCoverImage') {
                  const data = safeParseJSON(part.content) as GeneratedImage | null;
                  if (!data?.url) {
                    return <ToolErrorCard key={i} message="Image generation failed." />;
                  }
                  return (
                    <GeneratedImageCard
                      key={i}
                      image={data}
                      onAdd={onAddMedia}
                    />
                  );
                }

                if (toolName === 'schedulePost') {
                  const data = safeParseJSON(part.content) as ScheduledPostResult | null;
                  if (!data?.postId || !data?.scheduledDisplay) {
                    return <ToolErrorCard key={i} message="Scheduling failed." />;
                  }
                  return (
                    <ScheduledPostCard
                      key={i}
                      scheduledDisplay={data.scheduledDisplay}
                      postId={data.postId}
                    />
                  );
                }

                const data = safeParseTwitterResult(part.content);
                if (!data) return <ToolErrorCard key={i} message="Assistant returned an invalid tool result." />;
                if ('error' in data && data.error.trim()) {
                  return <ToolErrorCard key={i} message={data.error} />;
                }
                if (!('content' in data)) {
                  return <ToolErrorCard key={i} message="Assistant returned an incomplete tool result." />;
                }

                return (
                  <ToolResultCard
                    key={i}
                    content={data.content}
                    thread={data.thread}
                    onApply={() => applyContent(data.content, data.thread)}
                  />
                );
              }

              return null;
            })}
          </div>
        ))}

        {isLoading && messages[messages.length - 1]?.role !== 'assistant' && (
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <BrailleSpinner />
            Thinking...
          </div>
        )}
      </div>

      {currentContent?.trim() && (
        <div className="px-4 pb-2 flex flex-col gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="w-full text-xs gap-1.5"
            onClick={handleSuggestCoverImages}
            disabled={isLoading}
          >
            <Image className="w-3 h-3" />
            Suggest cover images
          </Button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="p-4 pt-2 border-t border-border">
        <div className="flex-1 w-full flex flex-col rounded-2xl border border-border bg-[var(--color-bg-subtle)] ring-1 ring-[var(--color-ring-elevated)] overflow-hidden min-h-[56px]">
          <Textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything..."
            className="resize-none text-sm min-h-[48px] py-3 px-4 border-0 bg-transparent rounded-none focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-muted-foreground flex-1"
            rows={2}
            disabled={isLoading}
          />
          <div className="flex items-center justify-between px-3 py-1.5 border-t border-border/50 shrink-0">
            <div className="flex items-center gap-3 text-muted-foreground">
              <button type="button" className="p-1.5 rounded-md hover:bg-muted hover:text-foreground" aria-label="Add attachment">
                <Plus className="w-4 h-4" />
              </button>
              <button type="button" className="flex items-center gap-1.5 px-1.5 py-1 rounded-md hover:bg-muted hover:text-foreground text-xs" aria-label="Tools">
                <Wrench className="w-4 h-4" />
                Tools
              </button>
              {brands.length > 0 && (
                <Select value={brandId} onValueChange={setBrandId}>
                  <SelectTrigger className="h-7 w-auto text-xs gap-1.5 border-0 bg-transparent hover:bg-muted [&>span]:line-clamp-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {brands.map(b => (
                      <SelectItem key={b.id} value={b.id} className="text-xs">
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger className="h-7 w-auto text-xs gap-1.5 border-0 bg-transparent hover:bg-muted [&>span]:line-clamp-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto" className="text-xs">Auto suggest</SelectItem>
                  <SelectItem value="freeform" className="text-xs">Free-form</SelectItem>
                  {templates.map(t => (
                    <SelectItem key={t.id} value={t.id} className="text-xs">
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {templateId === 'freeform' && (
                <Input
                  value={writingPrompt}
                  onChange={e => setWritingPrompt(e.target.value)}
                  placeholder="Writing prompt (optional)"
                  className="h-7 w-48 text-xs"
                />
              )}
            </div>
            <div className="flex items-center gap-1">
              <button type="button" className="p-1.5 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Voice input">
                <Mic className="w-4 h-4" />
              </button>
              <Button
                type="submit"
                size="sm"
                disabled={isLoading || !input.trim()}
              >
                <ArrowUp className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}

type TwitterResult = { content: string; thread: string[] } | { error: string };

interface PostSuggestion {
  templateName: string;
  content: string;
  thread: string[];
}

interface ImageSuggestion {
  title: string;
  description: string;
  prompt: string;
  type: 'serious' | 'meme';
}

interface GeneratedImage {
  id: string;
  filename: string;
  path: string;
  url: string;
  type: 'image';
  title: string;
}

interface ScheduledPostResult {
  postId: string;
  scheduledAt: string;
  scheduledDisplay: string;
}

function safeParseJSON(content: string): Record<string, unknown> | null {
  try {
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function safeParseTwitterResult(content: string): TwitterResult | null {
  try {
    const data = JSON.parse(content);
    if (typeof data.content === 'string') {
      return { content: data.content, thread: Array.isArray(data.thread) ? data.thread : [] };
    }
  } catch { }

  if (content.startsWith('Error executing tool:')) {
    return { error: content.replace('Error executing tool:', '').trim() || 'Tool execution failed.' };
  }
  return null;
}

function ToolErrorCard({ message }: { message: string }) {
  return (
    <div className="bg-red-50 border border-red-200 rounded-lg p-3 max-w-[90%] text-xs text-red-700">
      {message}
    </div>
  );
}

function ToolResultCard({ content, thread, onApply }: { content: string; thread: string[]; onApply: () => void }) {
  return (
    <div className="bg-[var(--color-bg-subtle)] border border-border rounded-lg p-3 max-w-[90%] space-y-2">
      <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
        <Twitter className="w-3 h-3 text-[#1d9bf0]" />
        Twitter{thread.length > 0 ? ` Thread (${1 + thread.length})` : ''}
      </div>
      <div className="text-xs whitespace-pre-wrap">{content}</div>
      {thread.map((tweet, i) => (
        <div key={i} className="text-xs whitespace-pre-wrap border-t border-border pt-2 mt-2">
          {tweet}
        </div>
      ))}
      <Button size="sm" className="w-full text-xs gap-1.5" onClick={onApply}>
        <Check className="w-3 h-3" />
        Apply
      </Button>
    </div>
  );
}

function ScheduledPostCard({ scheduledDisplay, postId }: { scheduledDisplay: string; postId: string }) {
  return (
    <div className="bg-[var(--color-bg-subtle)] border border-border rounded-lg p-3 max-w-[90%] space-y-1.5">
      <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
        <CalendarClock className="w-3 h-3" />
        Scheduled
      </div>
      <div className="text-xs">{scheduledDisplay}</div>
      <div className="text-[10px] text-muted-foreground">Post ID: {postId}</div>
    </div>
  );
}

function ImageSuggestionsCard({
  suggestions,
  onGenerate,
  disabled,
}: {
  suggestions: ImageSuggestion[];
  onGenerate: (title: string, prompt: string) => void;
  disabled: boolean;
}) {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  function handleCopyAndOpenSora(prompt: string, index: number) {
    navigator.clipboard.writeText(prompt);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
    window.open('https://sora.com', '_blank');
  }

  return (
    <div className="bg-[var(--color-bg-subtle)] border border-border rounded-lg p-3 max-w-[90%] space-y-2">
      <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
        <Image className="w-3 h-3" />
        Cover image ideas
      </div>
      {suggestions.map((s, i) => (
        <div key={i} className="border border-border rounded-md p-2.5 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium">{s.title}</span>
            <span
              className={cn(
                'text-[9px] px-1.5 py-0.5 rounded-full font-medium',
                s.type === 'meme'
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-blue-100 text-blue-700',
              )}
            >
              {s.type}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground">{s.description}</p>
          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="flex-1 text-xs gap-1.5 h-7"
              onClick={() => onGenerate(s.title, s.prompt)}
              disabled={disabled}
            >
              <Sparkles className="w-3 h-3" />
              Generate
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="flex-1 text-xs gap-1.5 h-7"
              onClick={() => handleCopyAndOpenSora(s.prompt, i)}
            >
              {copiedIndex === i ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              {copiedIndex === i ? 'Copied!' : 'Open Sora'}
              {copiedIndex !== i && <ExternalLink className="w-2.5 h-2.5" />}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function SuggestedPostsCard({
  suggestions,
  appliedKey,
  onApply,
}: {
  suggestions: PostSuggestion[];
  appliedKey: string | null;
  onApply: (content: string, thread: string[], index: number) => void;
}) {
  return (
    <div className="bg-[var(--color-bg-subtle)] border border-border rounded-lg p-3 max-w-[90%] space-y-2">
      <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
        {suggestions.length} draft{suggestions.length !== 1 ? 's' : ''}
      </div>
      {suggestions.map((s, i) => (
        <div key={i} className="border border-border rounded-md p-2.5 space-y-1.5">
          <div className="text-[10px] font-medium text-muted-foreground">{s.templateName}</div>
          <div className="text-xs whitespace-pre-wrap">{s.content}</div>
          {appliedKey ? (
            <div className="text-[10px] text-center text-green-600 py-1 flex items-center justify-center gap-1">
              <Check className="w-3 h-3" />
              Applied to post
            </div>
          ) : (
            <Button
              size="sm"
              className="w-full text-xs gap-1.5 h-7"
              onClick={() => onApply(s.content, s.thread, i)}
            >
              <Check className="w-3 h-3" />
              Apply
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}

function GeneratedImageCard({
  image,
  onAdd,
}: {
  image: GeneratedImage;
  onAdd?: (media: UploadedMedia) => void;
}) {
  return (
    <div className="bg-[var(--color-bg-subtle)] border border-border rounded-lg p-3 max-w-[90%] space-y-2">
      <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
        <Image className="w-3 h-3" />
        {image.title}
      </div>
      <img
        src={image.url}
        alt={image.title}
        className="w-full rounded-md object-cover"
      />
      {onAdd && (
        <Button size="sm" className="w-full text-xs gap-1.5" onClick={() => onAdd(image)}>
          <Check className="w-3 h-3" />
          Add to post
        </Button>
      )}
    </div>
  );
}
