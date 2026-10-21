// ABOUTME: Post view/edit route. /posts/new creates, /posts/$id edits an existing post.
// ABOUTME: Renders PostEditorView as a full-page experience.

import { createFileRoute, notFound, useNavigate } from '@tanstack/react-router';
import { PostEditorView } from '@/components/post-modal/PostEditorView';
import { getPost } from '@/app/server-fns/posts';
import { useWorkspace } from '@/lib/workspace-context';

export const Route = createFileRoute('/posts_/$id')({
  validateSearch: (search: Record<string, unknown>): { date?: string; prompt?: string } => ({
    date: typeof search.date === 'string' ? search.date : undefined,
    prompt: typeof search.prompt === 'string' ? search.prompt : undefined,
  }),
  loader: async ({ params }) => {
    if (params.id === 'new') return { post: null };
    const post = await getPost({ data: { id: params.id } });
    if (!post) throw notFound();
    return { post };
  },
  component: PostDetailPage,
});

function PostDetailPage() {
  const { post } = Route.useLoaderData();
  const { date, prompt } = Route.useSearch();
  const { refreshPosts } = useWorkspace();
  const navigate = useNavigate();

  function close() {
    navigate({ to: '/posts', search: { status: 'all' } });
  }

  function handleSaved() {
    refreshPosts();
    close();
  }

  return (
    <div className="h-full flex">
      <PostEditorView
        onSaved={handleSaved}
        onDelete={handleSaved}
        existing={post ?? undefined}
        initialDate={date ? new Date(date) : undefined}
        initialPrompt={prompt}
      />
    </div>
  );
}
