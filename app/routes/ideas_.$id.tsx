// ABOUTME: Idea detail page — shows full idea with comment/activity timeline and AI variation generation.
// ABOUTME: Users can suggest changes with brand voice, apply them to update the idea, and mark done.

import { createFileRoute, notFound, useNavigate } from '@tanstack/react-router';
import { useState, useCallback, useEffect, useRef } from 'react';
import { Lightbulb, CheckCircle2, RotateCcw, Trash2, Check, Wand2, Loader2 } from "@/components/icons";
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getIdea, setIdeaStatus, rewriteIdea } from '@/app/server-fns/ideas';
import { getBrands } from '@/app/server-fns/brands';
import { getTemplates } from '@/app/server-fns/templates';
import { getIdeaComments, createIdeaComment, applyCommentToIdea, deleteComment } from '@/app/server-fns/idea-comments';
import { useWorkspace } from '@/lib/workspace-context';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { IdeaComment, Idea, BrandProfile, Template } from '@/lib/db/types';
import { useDashboardHeader } from '@/lib/dashboard-header-context';

type LoaderData = {
  idea: Idea;
  comments: Array<IdeaComment & { user_name: string | null }>;
  brands: BrandProfile[];
  templates: Template[];
};

export const Route = createFileRoute('/ideas_/$id')({
  validateSearch: (search: Record<string, unknown>) => ({
    assistant: search.assistant === 'generate' ? 'generate' : undefined,
    brandId: typeof search.brandId === 'string' ? search.brandId : undefined,
    templateId: typeof search.templateId === 'string' ? search.templateId : undefined,
    instruction: typeof search.instruction === 'string' ? search.instruction : undefined,
  }),
  loader: async ({ params }) => {
    const idea = await getIdea({ data: { id: params.id } });
    if (!idea) throw notFound();

    const [comments, brands, templates] = await Promise.all([
      getIdeaComments({ data: { ideaId: params.id } }).catch(() => []),
      getBrands().catch(() => []),
      getTemplates().catch(() => []),
    ]);

    return { idea, comments, brands, templates };
  },
  component: IdeaDetailPage,
  errorComponent: ({ error }) => (
    <div className="p-8 text-center">
      <h2 className="text-lg font-semibold text-red-600 mb-2">Error loading idea</h2>
      <p className="text-sm text-muted-foreground">{error instanceof Error ? error.message : 'Unable to load this idea.'}</p>
    </div>
  ),
  notFoundComponent: () => (
    <div className="p-8 text-center">
      <h2 className="text-lg font-semibold mb-2">Idea not found</h2>
      <p className="text-sm text-muted-foreground">This idea may have been deleted.</p>
    </div>
  ),
});

function IdeaDetailPage() {
  const { idea: initialIdea, comments: initialComments, brands, templates } = Route.useLoaderData() as LoaderData;
  const [idea, setIdea] = useState(initialIdea);
  const [comments, setComments] = useState(initialComments);
  const [isUpdating, setIsUpdating] = useState(false);
  const { refreshIdeas } = useWorkspace();
  const { setActions, setBreadcrumbSuffix } = useDashboardHeader();

  const handleIdeaUpdated = useCallback((updatedIdea: Idea) => {
    setIdea(updatedIdea);
    refreshIdeas();
  }, [refreshIdeas]);

  const handleCommentsChanged = useCallback((newComments: Array<IdeaComment & { user_name: string | null }>) => {
    setComments(newComments);
  }, []);

  async function handleToggleStatus() {
    setIsUpdating(true);
    try {
      const newStatus = idea.status === 'open' ? 'closed' : 'open';
      const updated = await setIdeaStatus({ data: { id: idea.id, status: newStatus } });
      handleIdeaUpdated({ ...idea, status: newStatus, updated_at: updated.updated_at });
      toast.success(newStatus === 'closed' ? 'Idea marked as done' : 'Idea reopened');
    } finally {
      setIsUpdating(false);
    }
  }

  const isClosed = idea.status === 'closed';

  useEffect(() => {
    setBreadcrumbSuffix(
      <Badge variant={isClosed ? 'secondary' : 'default'} className="capitalize text-xs">
        {idea.status}
      </Badge>
    );

    setActions(
      <Button
        variant={isClosed ? 'outline' : 'secondary'}
        size="sm"
        onClick={handleToggleStatus}
        disabled={isUpdating}
        className="h-8 gap-1.5 text-xs"
      >
        {isUpdating ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : isClosed ? (
          <>
            <RotateCcw className="w-3.5 h-3.5" />
            Reopen
          </>
        ) : (
          <>
            <CheckCircle2 className="w-3.5 h-3.5" />
            Mark Done
          </>
        )}
      </Button>
    );

    return () => {
      setActions(null);
      setBreadcrumbSuffix(null);
    };
  }, [idea.status, isClosed, isUpdating, setActions, setBreadcrumbSuffix]);

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="mx-auto flex min-h-0 w-full flex-1 flex-col gap-6 px-6 py-6">
        <div className="flex items-start gap-3">
          <Lightbulb className={cn('w-4 h-4 mt-0.5 shrink-0', isClosed ? 'text-muted-foreground' : 'text-yellow-400')} />
          <div className="flex-1 min-w-0">
            <p className={cn(
              'text-base leading-relaxed',
              isClosed && 'text-muted-foreground line-through'
            )}>
              {idea.text}
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              Created {new Date(idea.created_at).toLocaleDateString()}
              {idea.updated_at !== idea.created_at && (
                <> · Updated {new Date(idea.updated_at).toLocaleDateString()}</>
              )}
            </p>
          </div>
        </div>

        <div className="min-h-0 flex-1">
          <ActivitySection
            ideaId={idea.id}
            comments={comments}
            brands={brands}
            templates={templates}
            isClosed={isClosed}
            onIdeaUpdated={handleIdeaUpdated}
            onCommentsChanged={handleCommentsChanged}
          />
        </div>
      </div>
    </div>
  );
}

function ActivitySection({
  ideaId,
  comments,
  brands,
  templates,
  isClosed,
  onIdeaUpdated,
  onCommentsChanged,
}: {
  ideaId: string;
  comments: Array<IdeaComment & { user_name: string | null }>;
  brands: BrandProfile[];
  templates: Template[];
  isClosed: boolean;
  onIdeaUpdated: (idea: Idea) => void;
  onCommentsChanged: (comments: Array<IdeaComment & { user_name: string | null }>) => void;
}) {
  const navigate = useNavigate();
  const { assistant, brandId: initialBrandId, templateId: initialTemplateId, instruction: initialInstruction } = Route.useSearch();
  const [comment, setComment] = useState('');
  const [selectedBrandId, setSelectedBrandId] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const hasAutoGeneratedRef = useRef(false);

  async function generateSuggestions({
    brandId,
    templateId,
    instruction,
  }: {
    brandId: string;
    templateId: string;
    instruction?: string;
  }) {
    const selectedBrand = brands.find(b => b.id === brandId);

    setIsGenerating(true);
    try {
      const suggestions = await rewriteIdea({
        data: {
          ideaId,
          brandId,
          instruction: instruction || undefined,
          templateId,
        },
      });

      const brandName = selectedBrand?.name ?? 'brand';
      await Promise.all(suggestions.map(suggestion => createIdeaComment({
        data: {
          ideaId,
          content: `Generated with ${brandName} voice · ${suggestion.templateName}`,
          suggestedText: suggestion.content,
        },
      })));

      const updated = await getIdeaComments({ data: { ideaId } });
      onCommentsChanged(updated);
      setComment('');
      const count = suggestions.length;
      toast.success(`${count} variation${count === 1 ? '' : 's'} generated and added to timeline`);
    } catch {
      toast.error('Generation failed');
    } finally {
      setIsGenerating(false);
    }
  }

  useEffect(() => {
    if (assistant !== 'generate' || hasAutoGeneratedRef.current || !initialBrandId) return;
    hasAutoGeneratedRef.current = true;
    setSelectedBrandId(initialBrandId);
    setSelectedTemplateId(initialTemplateId || 'auto');
    setComment(initialInstruction || '');
    generateSuggestions({
      brandId: initialBrandId,
      templateId: initialTemplateId || 'auto',
      instruction: initialInstruction,
    }).finally(() => {
      navigate({
        to: '/ideas/$id',
        params: { id: ideaId },
        search: {
          assistant: undefined,
          brandId: undefined,
          templateId: undefined,
          instruction: undefined,
        },
        replace: true,
      });
    });
  }, [assistant, ideaId, initialBrandId, initialInstruction, initialTemplateId, navigate]);

  async function handleGenerate() {
    if (!selectedBrandId || isGenerating) return;
    await generateSuggestions({
      brandId: selectedBrandId,
      templateId: selectedTemplateId || 'freeform',
      instruction: comment.trim(),
    });
  }

  async function handleApply(commentId: string) {
    setApplyingId(commentId);
    try {
      await applyCommentToIdea({ data: { commentId, ideaId } });
      const [updatedIdea, updatedComments] = await Promise.all([
        getIdea({ data: { id: ideaId } }),
        getIdeaComments({ data: { ideaId } }),
      ]);
      if (updatedIdea) onIdeaUpdated(updatedIdea);
      onCommentsChanged(updatedComments);
      toast.success('Variation applied');
    } finally {
      setApplyingId(null);
    }
  }

  async function handleDelete(commentId: string) {
    setDeletingId(commentId);
    try {
      await deleteComment({ data: { commentId } });
      const updated = await getIdeaComments({ data: { ideaId } });
      onCommentsChanged(updated);
      toast.success('Deleted');
    } finally {
      setDeletingId(null);
    }
  }

  const canGenerate = selectedBrandId && !isGenerating;

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="flex-1 min-h-0 overflow-y-auto pr-1">
        {comments.length > 0 && (
          <div className="space-y-3 pb-4">
            {comments.map(c => (
              <CommentCard
                key={c.id}
                comment={c}
                onApply={handleApply}
                onDelete={handleDelete}
                isApplying={applyingId === c.id}
                isDeleting={deletingId === c.id}
              />
            ))}
          </div>
        )}

        {comments.length === 0 && isClosed && (
          <p className="text-center text-sm text-muted-foreground py-6">No comments on this idea.</p>
        )}
      </div>

      {!isClosed && (
        <div className="shrink-0 border-t bg-background/95 pt-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="rounded-xl border bg-card overflow-hidden">
            <Textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              placeholder="Add instructions for the AI (optional)..."
              className="min-h-[80px] resize-none text-sm border-0 rounded-none focus-visible:ring-0 focus-visible:ring-offset-0 px-4 pt-3 pb-2"
            />

            <div className="flex items-center gap-2 px-3 py-2 border-t bg-muted/30">
              {brands.length > 0 && (
                <Select value={selectedBrandId} onValueChange={setSelectedBrandId}>
                  <SelectTrigger className="w-[130px] h-7 text-xs bg-background border-0 shadow-sm">
                    <SelectValue placeholder="Brand voice..." />
                  </SelectTrigger>
                  <SelectContent>
                    {brands.map(brand => (
                      <SelectItem key={brand.id} value={brand.id} className="text-xs">
                        {brand.name}
                        {brand.is_default && <span className="ml-1 text-muted-foreground">(default)</span>}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              <Select value={selectedTemplateId || 'freeform'} onValueChange={setSelectedTemplateId}>
                <SelectTrigger className="w-[130px] h-7 text-xs bg-background border-0 shadow-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="freeform" className="text-xs">Free form</SelectItem>
                  <SelectItem value="auto" className="text-xs">Auto suggest</SelectItem>
                  {templates.map(template => (
                    <SelectItem key={template.id} value={template.id} className="text-xs">
                      {template.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                type="button"
                size="sm"
                onClick={handleGenerate}
                disabled={!canGenerate}
                className="h-7 gap-1.5 text-xs px-3 ml-auto"
              >
                {isGenerating ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Wand2 className="w-3.5 h-3.5" />
                )}
                Generate
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CommentCard({
  comment,
  onApply,
  onDelete,
  isApplying,
  isDeleting,
}: {
  comment: IdeaComment & { user_name: string | null };
  onApply: (id: string) => void;
  onDelete: (id: string) => void;
  isApplying: boolean;
  isDeleting: boolean;
}) {
  return (
    <div className={cn(
      'rounded-xl border p-4 transition-all',
      comment.is_applied ? 'bg-green-50/50 border-green-200 dark:bg-green-950/20 dark:border-green-900' : 'bg-card border-border'
    )}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm">{comment.user_name || 'You'}</span>
          <span className="text-xs text-muted-foreground">
            {new Date(comment.created_at).toLocaleDateString()}
          </span>
          {comment.is_applied && (
            <Badge variant="default" className="bg-green-600 text-white gap-1 text-xs">
              <Check className="w-3 h-3" />
              Applied
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {!comment.is_applied && comment.suggested_text && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onApply(comment.id)}
              disabled={isApplying}
              className="h-6 text-xs gap-1 text-green-600 hover:text-green-700 hover:bg-green-50"
            >
              {isApplying ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
              Accept
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onDelete(comment.id)}
            disabled={isDeleting}
            className="h-6 text-xs text-muted-foreground hover:text-red-600"
          >
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
      </div>

      <p className="text-sm">{comment.content}</p>

      {comment.suggested_text && (
        <div className="mt-3 p-3 bg-muted rounded-lg">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Variation</p>
          <p className="text-sm whitespace-pre-wrap">{comment.suggested_text}</p>
        </div>
      )}
    </div>
  );
}
