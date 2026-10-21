// ABOUTME: Posts list page with status filter via ?status= search param.
// ABOUTME: Clicking a card navigates to /posts/$id.

import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { FileText, Plus, Trash2, Clock, CheckCircle2, AlertCircle, ShieldCheck } from "@/components/icons";
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/lib/workspace-context';
import { Button } from '@/components/ui/button';
import { deletePost } from '@/app/server-fns/posts';
import { htmlToText } from '@/lib/text';
import { sortPostsByDate, type PostListStatus } from '@/lib/post-order';
import type { PostWithDetails } from '@/lib/db/types';

type PostStatus = PostListStatus;

const STATUS_VALUES: PostStatus[] = ['all', 'draft', 'scheduled', 'awaiting_approval', 'published'];

export const Route = createFileRoute('/posts')({
  validateSearch: (search: Record<string, unknown>): { status: PostStatus } => {
    const raw = typeof search.status === 'string' ? search.status : 'all';
    const status = STATUS_VALUES.includes(raw as PostStatus) ? (raw as PostStatus) : 'all';
    return { status };
  },
  component: PostsPage,
});

function PostsPage() {
  const { posts, refreshPosts } = useWorkspace();
  const { status } = Route.useSearch();
  const navigate = useNavigate();

  const filteredPosts = sortPostsByDate(posts.filter(post => {
    if (status === 'all') return true;
    return post.state === status;
  }), status);

  const tabs: { key: PostStatus; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: posts.length },
    { key: 'draft', label: 'Drafts', count: posts.filter(p => p.state === 'draft').length },
    { key: 'scheduled', label: 'Scheduled', count: posts.filter(p => p.state === 'scheduled').length },
    { key: 'awaiting_approval', label: 'Approval', count: posts.filter(p => p.state === 'awaiting_approval').length },
    { key: 'published', label: 'Published', count: posts.filter(p => p.state === 'published').length },
  ];

  async function handleDeletePost(id: string) {
    await deletePost({ data: { id } });
    refreshPosts();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        {tabs.map(({ key, label, count }) => (
          <Link
            key={key}
            to="/posts"
            search={{ status: key }}
            className={cn(
              'inline-flex h-8 items-center rounded-lg border px-3 text-sm font-medium transition-all',
              status === key
                ? 'border-[var(--color-border)] bg-[var(--color-bg-muted)] text-[var(--color-text)] shadow-button-pressed'
                : 'border-transparent text-[var(--color-text-muted)] hover:border-[var(--color-border)] hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-text)]'
            )}
          >
            {label}
            {count > 0 && (
              <span className="ml-1.5 text-xs text-[var(--color-text-muted)]">{count}</span>
            )}
          </Link>
        ))}
      </div>

      {filteredPosts.length === 0 ? (
        <div className="surface-gradient flex flex-col items-center justify-center rounded-2xl border border-[var(--color-border)] px-6 py-20 text-center text-[var(--color-text-muted)] shadow-panel">
          <FileText className="w-12 h-12 mb-4 opacity-30" />
          <p className="text-sm">No posts yet</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => navigate({ to: '/posts/$id', params: { id: 'new' }, search: {} })}
          >
            <Plus className="w-4 h-4 mr-1" />
            Create your first post
          </Button>
        </div>
      ) : (
        <div className="grid gap-3">
          {filteredPosts.map(post => (
            <PostCard
              key={post.id}
              post={post}
              onDelete={() => handleDeletePost(post.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PostCard({
  post,
  onDelete,
}: {
  post: PostWithDetails;
  onDelete: () => void;
}) {
  const content = htmlToText(post.targets[0]?.content ?? '') || '(no content)';
  const platforms = post.targets.map(t => t.platform);

  return (
    <Link
      to="/posts/$id"
      params={{ id: post.id }}
      search={{}}
      className="group surface-gradient flex items-start gap-4 rounded-xl border border-[var(--color-border)] p-4 shadow-panel transition-all hover:border-[var(--color-border-opaque)] hover:bg-[var(--color-bg-muted)]"
    >
      <div className="mt-0.5">
        {post.state === 'draft' && <FileText className="w-4 h-4 text-[var(--color-text-muted)]" />}
        {post.state === 'scheduled' && <Clock className="w-4 h-4 text-blue-400" />}
        {(post.state === 'awaiting_approval' || post.state === 'publishing') && <ShieldCheck className="w-4 h-4 text-violet-500" />}
        {post.state === 'published' && <CheckCircle2 className="w-4 h-4 text-green-400" />}
        {post.state === 'failed' && <AlertCircle className="w-4 h-4 text-red-400" />}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm text-[var(--color-text)] line-clamp-2">{content}</p>
        <div className="flex items-center gap-3 mt-2 text-xs text-[var(--color-text-muted)]">
          <span className="capitalize">{post.state}</span>
          {post.publish_at && (
            <span>Scheduled for {new Date(post.publish_at).toLocaleDateString()}</span>
          )}
          <span>{platforms.join(', ')}</span>
        </div>
      </div>

      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(); }}
        className="opacity-0 group-hover:opacity-100 p-1.5 text-[var(--color-text-muted)] hover:text-red-400 transition-all"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </Link>
  );
}
