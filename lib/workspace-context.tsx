// ABOUTME: Shared state for posts and ideas across all routes.
// ABOUTME: Loaded once in root loader, refreshable from any child via useWorkspace().

import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import type { PostWithDetails, Idea } from '@/lib/db/types';

interface WorkspaceState {
  posts: PostWithDetails[];
  ideas: Idea[];
  refreshPosts: () => Promise<void>;
  refreshIdeas: () => Promise<void>;
  selectedIdea: Idea | undefined;
  setSelectedIdea: (idea: Idea | undefined) => void;
  ideaModalOpen: boolean;
  setIdeaModalOpen: (open: boolean) => void;
  editingIdea: Idea | undefined;
  setEditingIdea: (idea: Idea | undefined) => void;
}

const WorkspaceContext = createContext<WorkspaceState | null>(null);

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used within WorkspaceProvider');
  return ctx;
}

interface WorkspaceProviderProps {
  initialPosts: PostWithDetails[];
  initialIdeas: Idea[];
  fetchPosts: () => Promise<PostWithDetails[]>;
  fetchIdeas: () => Promise<Idea[]>;
  children: React.ReactNode;
}

export function WorkspaceProvider({
  initialPosts, initialIdeas, fetchPosts, fetchIdeas, children,
}: WorkspaceProviderProps) {
  const [posts, setPosts] = useState(initialPosts);
  const [ideas, setIdeas] = useState(initialIdeas);
  const [selectedIdea, setSelectedIdea] = useState<Idea | undefined>();
  const [ideaModalOpen, setIdeaModalOpen] = useState(false);
  const [editingIdea, setEditingIdea] = useState<Idea | undefined>();

  const refreshPosts = useCallback(async () => {
    const fresh = await fetchPosts();
    setPosts(fresh);
  }, [fetchPosts]);

  const refreshIdeas = useCallback(async () => {
    const fresh = await fetchIdeas();
    setIdeas(fresh);
    setSelectedIdea(prev => {
      if (!prev) return undefined;
      return fresh.find(idea => idea.id === prev.id) ?? prev;
    });
  }, [fetchIdeas]);

  useEffect(() => {
    setPosts(initialPosts);
  }, [initialPosts]);

  useEffect(() => {
    setIdeas(initialIdeas);
    setSelectedIdea(prev => {
      if (!prev) return undefined;
      return initialIdeas.find(idea => idea.id === prev.id);
    });
  }, [initialIdeas]);

  return (
    <WorkspaceContext.Provider value={{
      posts, ideas,
      refreshPosts, refreshIdeas,
      selectedIdea, setSelectedIdea,
      ideaModalOpen, setIdeaModalOpen,
      editingIdea, setEditingIdea,
    }}>
      {children}
    </WorkspaceContext.Provider>
  );
}
