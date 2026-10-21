// ABOUTME: Ideas page — dashboard view with ideas list.

import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { Lightbulb, Plus, Trash2, RotateCcw, Search, ArrowRight, X, MessageSquare } from "@/components/icons";
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/lib/workspace-context';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { IdeaChat } from '@/components/ideas/IdeaChat';
import { deleteIdea, setIdeaStatus } from '@/app/server-fns/ideas';
import type { Idea } from '@/lib/db/types';

export const Route = createFileRoute('/ideas')({
  validateSearch: (search: Record<string, unknown>): { assistant?: 'new' } => ({
    assistant: search.assistant === 'new' ? 'new' : undefined,
  }),
  component: IdeasPage,
});

type IdeaTab = 'open' | 'closed' | 'all';

export default function IdeasPage() {
  const { ideas, refreshIdeas, setEditingIdea, setIdeaModalOpen, setSelectedIdea } = useWorkspace();
  const { assistant } = Route.useSearch();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<IdeaTab>('open');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (assistant !== 'new') return;
    setSelectedIdea(undefined);
    setEditingIdea(undefined);
    setIdeaModalOpen(false);
  }, [assistant, setEditingIdea, setIdeaModalOpen, setSelectedIdea]);

  const filteredIdeas = useMemo(() => {
    let filtered = ideas;
    if (activeTab !== 'all') {
      filtered = ideas.filter(i => i.status === activeTab);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(i => i.text.toLowerCase().includes(q));
    }
    return filtered.sort((a, b) => b.updated_at - a.updated_at);
  }, [ideas, activeTab, searchQuery]);

  const tabs: { key: IdeaTab; label: string; count: number }[] = [
    { key: 'open', label: 'Open', count: ideas.filter(i => i.status === 'open').length },
    { key: 'closed', label: 'Closed', count: ideas.filter(i => i.status === 'closed').length },
    { key: 'all', label: 'All', count: ideas.length },
  ];

  async function handleDelete(id: string) {
    await deleteIdea({ data: { id } });
    refreshIdeas();
  }

  async function handleReopen(id: string) {
    await setIdeaStatus({ data: { id, status: 'open' } });
    refreshIdeas();
  }

  if (assistant === 'new') {
    return (
      <div className="h-full min-h-0 px-6 py-6 lg:px-8">
        <div className="flex h-full min-h-0 w-full flex-col">
          <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] shadow-panel">
            <IdeaChat onIdeasChanged={refreshIdeas} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {tabs.map(({ key, label, count }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={cn(
                'inline-flex h-8 items-center rounded-lg border px-3 text-sm font-medium transition-all',
                activeTab === key
                  ? 'border-[var(--color-border)] bg-[var(--color-bg-muted)] text-[var(--color-text)] shadow-button-pressed'
                  : 'border-transparent text-[var(--color-text-muted)] hover:border-[var(--color-border)] hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-text)]'
              )}
            >
              {label}
              {count > 0 && (
                <span className="ml-1.5 text-xs text-[var(--color-text-muted)]">{count}</span>
              )}
            </button>
          ))}
        </div>
        <div className="relative w-full max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
        <Input
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search ideas"
          className="pl-10 pr-10"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
      </div>

      {filteredIdeas.length === 0 ? (
        <div className="surface-gradient flex flex-col items-center justify-center rounded-2xl border border-[var(--color-border)] px-6 py-20 text-center text-[var(--color-text-muted)] shadow-panel">
          <Lightbulb className="w-12 h-12 mb-4 opacity-30" />
          <p className="text-sm">No ideas yet</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => {
              setSelectedIdea(undefined);
              setEditingIdea(undefined);
              setIdeaModalOpen(false);
              navigate({ to: '/ideas', search: { assistant: 'new' } });
            }}
          >
            <Plus className="w-4 h-4 mr-1" />
            Create your first idea
          </Button>
        </div>
      ) : (
        <div className="grid gap-3">
          {filteredIdeas.map(idea => (
            <IdeaCard
              key={idea.id}
              idea={idea}
              onEdit={() => { setEditingIdea(idea); setIdeaModalOpen(true); }}
              onDelete={() => handleDelete(idea.id)}
              onReopen={() => handleReopen(idea.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function IdeaCard({
  idea,
  onEdit,
  onDelete,
  onReopen,
}: {
  idea: Idea;
  onEdit: () => void;
  onDelete: () => void;
  onReopen: () => void;
}) {
  const isClosed = idea.status === 'closed';

  return (
    <div
      className="group surface-gradient flex items-start gap-4 rounded-xl border border-[var(--color-border)] p-4 shadow-panel transition-all hover:border-[var(--color-border-opaque)] hover:bg-[var(--color-bg-muted)]"
    >
      <div className={cn('mt-0.5', isClosed ? 'opacity-50' : '')}>
        <Lightbulb className={cn('w-4 h-4', isClosed ? 'text-[var(--color-text-muted)]' : 'text-yellow-400')} />
      </div>

      <Link
        to="/ideas/$id"
        params={{ id: idea.id }}
        search={{ assistant: undefined, brandId: undefined, templateId: undefined, instruction: undefined }}
        className="flex-1 min-w-0"
      >
        <p className={cn('text-sm [overflow-wrap:anywhere]', isClosed && 'text-[var(--color-text-muted)] line-through')}>
          {idea.text}
        </p>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs text-[var(--color-text-muted)]">
            {new Date(idea.updated_at).toLocaleDateString()}
          </span>
          <Badge variant="secondary" className="text-[10px]">
            <MessageSquare className="w-3 h-3 mr-1" />
            View
          </Badge>
        </div>
      </Link>

      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <Link
          to="/ideas/$id"
          params={{ id: idea.id }}
          search={{ assistant: undefined, brandId: undefined, templateId: undefined, instruction: undefined }}
          className="p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] rounded-md hover:bg-[var(--color-bg-muted)]"
          title="View idea details"
        >
          <ArrowRight className="w-4 h-4" />
        </Link>
        {isClosed && (
          <button
            onClick={onReopen}
            className="p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] rounded-md hover:bg-[var(--color-bg-muted)]"
            title="Reopen idea"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        )}
        <button
          onClick={onEdit}
          className="p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] rounded-md hover:bg-[var(--color-bg-muted)]"
          title="Edit idea"
        >
          Edit
        </button>
        <button
          onClick={onDelete}
          className="p-1.5 text-[var(--color-text-muted)] hover:text-red-400 rounded-md hover:bg-[var(--color-bg-muted)]"
          title="Delete idea"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
