// ABOUTME: Chat interface for the Ideas page — saves ideas on send, shows AI post suggestions.
// ABOUTME: Renders suggestPosts results as cards with Preview button; Preview opens PostPreview sheet with Move to Draft action.

'use client';

import { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import { useChat, fetchServerSentEvents } from '@tanstack/ai-react';
import { useNavigate } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, ArrowUp, Square, Eye, FileText, CheckCircle2, CalendarClock } from "@/components/icons";
import { BrailleSpinner } from '@/components/ui/braille-spinner';
import { cn } from '@/lib/utils';
import { createIdea, setIdeaStatus } from '@/app/server-fns/ideas';
import { createPost } from '@/app/server-fns/posts';
import { getChannels } from '@/app/server-fns/channels';
import { getBrands } from '@/app/server-fns/brands';
import { getTemplates } from '@/app/server-fns/templates';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { SimplePreviewCard } from '@/components/post-modal/SimplePreviewCard';
import { getIdeaConversation, saveIdeaConversation } from '@/app/server-fns/idea-conversations';
import { useWorkspace } from '@/lib/workspace-context';
import { toast } from 'sonner';
import type { Idea, BrandProfile, Template } from '@/lib/db/types';

interface IdeaChatProps {
  onIdeasChanged: () => void | Promise<void>;
  selectedIdea?: Idea;
}

export function IdeaChat({ onIdeasChanged, selectedIdea }: IdeaChatProps) {
  const { selectedIdea: workspaceSelectedIdea, setSelectedIdea } = useWorkspace();
  const navigate = useNavigate();
  const activeIdea = selectedIdea ?? workspaceSelectedIdea;
  const [input, setInput] = useState('');
  const [brands, setBrands] = useState<BrandProfile[]>([]);
  const [brandId, setBrandId] = useState<string>('');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState<string>('auto');
  const [writingPrompt, setWritingPrompt] = useState('');
  const [markingDone, setMarkingDone] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const prevStatusRef = useRef<string>('ready');
  const messagesRef = useRef<any[]>([]);
  const justCreatedIdeaRef = useRef<string | null>(null);

  function loadBrandsAndTemplates() {
    getBrands().then(list => {
      setBrands(list);
      if (!brandId) {
        const def = list.find(b => b.is_default) ?? list[0];
        if (def) setBrandId(def.id);
      }
    }).catch(() => {});
    getTemplates().then(setTemplates).catch(() => {});
  }

  useEffect(loadBrandsAndTemplates, []);

  const body = useMemo(() => ({
    ...(brandId ? { brandId } : {}),
    ...(templateId !== 'auto' ? { templateId } : {}),
    ...(templateId === 'freeform' && writingPrompt.trim() ? { writingPrompt: writingPrompt.trim() } : {}),
  }), [brandId, templateId, writingPrompt]);

  const { messages, setMessages, sendMessage, isLoading, status, stop } = useChat({
    connection: fetchServerSentEvents('/api/assistant'),
    body,
  });
  messagesRef.current = messages;

  useEffect(() => {
    if (!activeIdea) {
      setMessages([]);
      return;
    }

    if (brands.length === 0) loadBrandsAndTemplates();

    if (justCreatedIdeaRef.current === activeIdea.id) {
      justCreatedIdeaRef.current = null;
      return;
    }

    setLoadingHistory(true);
    getIdeaConversation({ data: { ideaId: activeIdea.id } })
      .then(stored => {
        if (stored && stored.length > 0) {
          setMessages(stored);
        } else {
          setMessages([]);
          sendMessage(activeIdea.text);
        }
      })
      .finally(() => setLoadingHistory(false));
  }, [activeIdea?.id]);

  useEffect(() => {
    if (prevStatusRef.current === 'streaming' && status === 'ready' && activeIdea && messagesRef.current.length > 0) {
      saveIdeaConversation({ data: { ideaId: activeIdea.id, messages: JSON.stringify(messagesRef.current) } });
    }
    prevStatusRef.current = status;
  }, [status]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || isLoading) return;
    setInput('');

    if (!activeIdea) {
      const newIdea = await createIdea({ data: { text } });
      justCreatedIdeaRef.current = newIdea.id;
      setSelectedIdea(newIdea);
      await onIdeasChanged();
      navigate({
        to: '/ideas/$id',
        params: { id: newIdea.id },
        search: {
          assistant: 'generate',
          brandId,
          templateId,
          instruction: templateId === 'freeform' ? writingPrompt.trim() : undefined,
        },
      });
      return;
    }
    sendMessage(text);
  }, [activeIdea, brandId, input, isLoading, navigate, onIdeasChanged, sendMessage, setSelectedIdea, templateId, writingPrompt]);

  async function handleMarkDone() {
    if (!activeIdea || activeIdea.status === 'closed' || markingDone) return;
    setMarkingDone(true);
    try {
      await setIdeaStatus({ data: { id: activeIdea.id, status: 'closed' } });
      await onIdeasChanged();
      toast.success('Idea marked as done');
    } finally {
      setMarkingDone(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  }

  const hasMessages = messages.length > 0;
  const starters = ['A product launch', 'A lesson I learned', 'A behind-the-scenes moment'];
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

  return (
    <div className="flex h-full min-h-[320px] flex-col bg-[var(--color-bg)]">
      {/* Header */}
      <div className="flex h-[68px] shrink-0 items-center border-b border-border px-5 sm:px-7">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-[var(--color-text)]">Idea assistant</h2>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">Shape a thought into ready-to-publish posts</p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {activeIdea && activeIdea.status !== 'closed' && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={handleMarkDone}
              disabled={!activeIdea || markingDone}
            >
              {markingDone ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="w-3.5 h-3.5" />
              )}
              Mark done
            </Button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col px-5 py-6 sm:px-7">
        {loadingHistory && (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <BrailleSpinner />
              <span>Loading conversation...</span>
            </div>
          </div>
        )}

        {!hasMessages && !loadingHistory && !isLoading && (
          <div className="flex flex-1 flex-col items-center justify-center py-12 text-center">
            <h3 className="text-xl font-semibold tracking-tight text-[var(--color-text)]">What would you like to share?</h3>
            <p className="mt-2 max-w-md text-sm leading-6 text-[var(--color-text-muted)]">
              Start with a rough thought. I’ll help shape it into posts that sound like you.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {starters.map(starter => (
                <Button
                  key={starter}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 rounded-full border-transparent bg-[var(--color-bg-muted)] px-4 text-[var(--color-text-secondary)] hover:border-transparent hover:bg-[var(--color-bg-muted-hover)]"
                  onClick={() => {
                    setInput(starter);
                    inputRef.current?.focus();
                  }}
                >
                  {starter}
                </Button>
              ))}
            </div>
          </div>
        )}

        {messages.map(msg => (
          <div key={msg.id} className={cn('mb-3', msg.role === 'user' ? 'flex justify-end' : '')}>
            {msg.parts.map((part, i) => {
              if (part.type === 'text' && part.content) {
                if (msg.role === 'user') {
                  return (
                    <div
                      key={i}
                      className="max-w-[85%] rounded-2xl rounded-br-md bg-primary text-primary-foreground px-3.5 py-2 text-sm"
                    >
                      {part.content}
                    </div>
                  );
                }
                return (
                  <div
                    key={i}
                    className="prose prose-sm max-w-none text-foreground prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-headings:mb-2 prose-headings:mt-3 prose-headings:text-sm"
                  >
                    {part.content}
                  </div>
                );
              }

              if (part.type === 'tool-call') {
                if (completedToolCallIds.has((part as any).id)) return null;
                const name = (part as any).name;
                const label = name === 'suggestPosts'
                  ? 'Generating suggestions...'
                  : name === 'schedulePost'
                    ? 'Scheduling post...'
                    : 'Working...';
                return (
                  <div key={i} className="text-xs text-muted-foreground flex items-center gap-1.5 py-1">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    {label}
                  </div>
                );
              }

              if (part.type === 'tool-result') {
                const data = safeParseToolResult(part.content);
                if (!data) {
                  return <ToolErrorLine key={i} message="Assistant returned an invalid tool result." />;
                }

                if (typeof data.error === 'string' && data.error.trim()) {
                  return <ToolErrorLine key={i} message={data.error} />;
                }

                if (data.suggestions) {
                  return (
                    <SuggestionsCard
                      key={i}
                      suggestions={data.suggestions}
                      disabled={isLoading}
                      templateId={templateId}
                      writingPrompt={writingPrompt}
                    />
                  );
                }

                if (typeof data.postId === 'string' && typeof data.scheduledDisplay === 'string') {
                  return (
                    <div key={i} className="flex max-w-[85%] items-center gap-1.5 rounded-lg border border-[color-mix(in_srgb,var(--color-positive)_28%,transparent)] bg-[color-mix(in_srgb,var(--color-positive)_10%,transparent)] px-3 py-2 text-xs text-[var(--color-positive)]">
                      <CalendarClock className="w-3.5 h-3.5" />
                      Scheduled for {data.scheduledDisplay}
                    </div>
                  );
                }

                return null;
              }

              return null;
            })}
          </div>
        ))}

        {isLoading && (
          <div className="mb-3 flex items-center gap-1.5 text-sm text-muted-foreground">
            <BrailleSpinner />
            <span>Thinking...</span>
          </div>
        )}
        </div>
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-border px-5 py-4 sm:px-7">
        <div className="mx-auto w-full max-w-5xl">
        <form onSubmit={handleSubmit}>
          <div className={cn(
            'rounded-xl border p-2 transition-[border-color,background-color]',
            isLoading
              ? 'border-[var(--color-border)] bg-[var(--color-bg-muted)]'
              : 'border-[var(--color-border-opaque)] bg-[var(--color-bg-elevated)] focus-within:border-[var(--color-accent)]',
          )}>
            <div className="px-2 pb-1 pt-1">
              <Textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={isLoading ? 'Waiting...' : 'Ask anything...'}
                className="min-h-[56px] resize-none rounded-md border-0 bg-transparent px-1 py-2 text-sm shadow-none focus-visible:border-0 focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-muted-foreground"
                rows={2}
                disabled={isLoading}
              />
            </div>
            <div className="flex min-h-9 items-center gap-1.5 px-1">
              {brands.length > 0 && (
                <Select value={brandId} onValueChange={setBrandId}>
                  <SelectTrigger className="h-8 w-auto gap-1.5 border-0 bg-transparent text-xs hover:bg-muted [&>span]:line-clamp-1">
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
                <SelectTrigger className="h-8 w-auto gap-1.5 border-0 bg-transparent text-xs hover:bg-muted [&>span]:line-clamp-1">
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
                  className="h-8 w-48 text-xs"
                />
              )}
              <div className="flex-1" />
              {isLoading ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={stop}
                  className="h-8 px-3 text-xs font-medium"
                >
                  <Square className="w-3 h-3 mr-1.5 fill-current" />
                  Stop
                </Button>
              ) : (
                <Button
                  type="submit"
                  size="sm"
                  disabled={!input.trim()}
                  className="h-8 w-8 rounded-lg p-0 active:scale-[0.96] disabled:border-[var(--color-border)] disabled:bg-[var(--color-bg-muted)] disabled:text-[var(--color-text-tertiary)] disabled:opacity-100"
                >
                  <ArrowUp className="w-4 h-4" />
                </Button>
              )}
            </div>
          </div>
        </form>
        <p className="mt-2 text-center text-[11px] text-[var(--color-text-tertiary)]">Review suggested posts before saving or scheduling.</p>
        </div>
      </div>
    </div>
  );
}

interface Suggestion {
  templateId?: string;
  templateName: string;
  content: string;
  thread?: string[];
}

function safeParseToolResult(content: unknown): Record<string, any> | null {
  if (content && typeof content === 'object') return content as Record<string, any>;
  if (typeof content !== 'string') return null;

  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch { }

  if (content.startsWith('Error executing tool:')) {
    return { error: content.replace('Error executing tool:', '').trim() };
  }

  return null;
}

function ToolErrorLine({ message }: { message: string }) {
  return (
    <div className="max-w-[85%] rounded-lg border border-[color-mix(in_srgb,var(--color-negative)_28%,transparent)] bg-[color-mix(in_srgb,var(--color-negative)_10%,transparent)] px-3 py-2 text-xs text-[var(--color-negative)]">
      {message}
    </div>
  );
}

function SuggestionsCard({ suggestions, disabled, templateId, writingPrompt }: {
  suggestions: Suggestion[];
  disabled: boolean;
  templateId?: string;
  writingPrompt?: string;
}) {
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [movingIndex, setMovingIndex] = useState<number | null>(null);
  const previewSuggestion = previewIndex !== null ? suggestions[previewIndex] : null;
  const navigate = useNavigate();
  const { refreshPosts, selectedIdea } = useWorkspace();

  async function handleMoveToDraft(index: number) {
    const suggestion = suggestions[index];
    if (!suggestion) return;
    setMovingIndex(index);

    const resolvedTemplateId =
      suggestion.templateId ||
      (templateId !== 'auto' && templateId !== 'freeform' ? templateId : undefined);

    try {
      const channels = await getChannels();
      const defaultTwitter = channels.find(channel => channel.platform === 'twitter' && channel.is_default);
      const defaultLinkedIn = channels.find(channel => channel.platform === 'linkedin' && channel.is_default);
      const post = await createPost({
        data: {
          targets: [
            { channel_id: defaultTwitter?.id, platform: 'twitter', content: suggestion.content, thread: suggestion.thread },
            { channel_id: defaultLinkedIn?.id, platform: 'linkedin', content: suggestion.content },
          ],
          state: 'draft',
          publish_at: null,
          idea_id: selectedIdea?.id,
          template_id: resolvedTemplateId,
          writing_prompt: writingPrompt?.trim() || undefined,
        },
      });
      if (!post) return;
      setPreviewIndex(null);
      toast.success('Draft created');
      refreshPosts();
      navigate({ to: '/posts/$id', params: { id: post.id }, search: {} });
    } finally {
      setMovingIndex(null);
    }
  }

  return (
    <>
      <div className="w-full max-w-3xl space-y-3">
        {suggestions.map((s, i) => (
          <div key={i} className="bg-muted rounded-lg p-3 space-y-2">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
              {s.templateName}
            </div>
            <div className="text-sm whitespace-pre-wrap">{s.content}</div>
            {s.thread?.length ? (
              <div className="space-y-1 border-t border-border pt-2">
                {s.thread.map((tweet, j) => (
                  <div key={j} className="text-sm whitespace-pre-wrap text-muted-foreground">{tweet}</div>
                ))}
              </div>
            ) : null}
            <div className="flex gap-1.5">
              <Button
                size="sm"
                variant="outline"
                className="text-xs gap-1.5"
                onClick={() => setPreviewIndex(i)}
                disabled={disabled}
              >
                <Eye className="w-3 h-3" />
                Preview
              </Button>
              <Button
                size="sm"
                className="text-xs gap-1.5"
                onClick={() => handleMoveToDraft(i)}
                disabled={movingIndex !== null}
              >
                {movingIndex === i ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />}
                Move to Draft
              </Button>
            </div>
          </div>
        ))}
      </div>

      <Sheet open={previewIndex !== null} onOpenChange={open => !open && setPreviewIndex(null)}>
        <SheetContent className="w-[480px] flex flex-col gap-0 p-0">
          <SheetHeader className="px-5 py-3 border-b border-border shrink-0">
            <SheetTitle className="text-sm font-semibold">Preview</SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto p-5">
            {previewSuggestion && (
              <SimplePreviewCard
                content={previewSuggestion.content}
                thread={previewSuggestion.thread}
              />
            )}
          </div>
          <div className="px-5 py-4 border-t border-border shrink-0">
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => previewIndex !== null && handleMoveToDraft(previewIndex)}
              disabled={movingIndex !== null}
            >
              {movingIndex === previewIndex ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
              Move to Draft
            </Button>
          </div>
        </SheetContent>
      </Sheet>

    </>
  );
}
