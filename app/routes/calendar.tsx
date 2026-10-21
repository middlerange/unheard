// ABOUTME: Calendar page — shows all posts in a monthly grid view.
// ABOUTME: Navigates to /posts/$id for editing and /posts/new for creation.

import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { CalendarView } from '@/components/calendar/CalendarView';
import { useWorkspace } from '@/lib/workspace-context';
import type { PostWithDetails } from '@/lib/db/types';

export const Route = createFileRoute('/calendar')({
  component: CalendarPage,
});

function CalendarPage() {
  const { posts } = useWorkspace();
  const navigate = useNavigate();

  function openNewPost(date?: Date) {
    navigate({
      to: '/posts/$id',
      params: { id: 'new' },
      search: date ? { date: date.toISOString() } : {},
    });
  }

  function openEditPost(post: PostWithDetails) {
    navigate({ to: '/posts/$id', params: { id: post.id }, search: {} });
  }

  return (
    <div className="flex h-full min-h-[70vh] flex-col overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] shadow-panel">
      <div className="flex-1 overflow-hidden">
        <CalendarView
          posts={posts}
          onNewPost={date => openNewPost(date)}
          onEditPost={openEditPost}
        />
      </div>
    </div>
  );
}
