// ABOUTME: Root layout for the authenticated dashboard shell with shared sidebar and page framing.
// ABOUTME: Public routes bypass the shell while app routes inherit the dashboard design system.

import {
  createRootRoute,
  HeadContent,
  Link,
  Outlet,
  redirect,
  Scripts,
  useLocation,
  useNavigate,
} from '@tanstack/react-router';
import userorbit from 'userorbit-js';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Toaster } from 'sonner';
import {
  House,
  LogOut,
  Settings,
  Plus,
  FileText,
  Lightbulb,
  Search,
  HelpCircle,
  CalendarDays,
  CaretDown,
} from "@/components/icons";
import { cn } from '@/lib/utils';
import { getAuthState, logout } from '@/app/server-fns/auth';
import { IdeaModal } from '@/components/ideas/IdeaModal';
import {
  WorkspaceProvider, useWorkspace,
} from '@/lib/workspace-context';
import { DashboardHeaderProvider, useDashboardHeader } from '@/lib/dashboard-header-context';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import appCss from '@/app/styles/globals.css?url';

const PUBLIC_PATHS = new Set(['/', '/login', '/signup', '/terms', '/privacy', '/data-deletion']);

if (typeof window !== 'undefined') {
  const supportConfig = {
    accountId: 'a20a0686-db8d-423f-ac7e-d15987f61c4b',
    apiHost: 'https://api.userorbit.com',
    userId: '<user-id>',
    email: '<email>',
    name: '<name>',
    attributes: {
      'user.role': '<user-role>',
      'user.company': '<user-company>',
      'user.plan': '<user-plan>',
    },
    openOptions: {
      activeTabs: ['home', 'feedback', 'roadmap', 'updates', 'help'],
    },
  };
  void userorbit.init(supportConfig);
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Unheard' },
      { name: 'apple-mobile-web-app-title', content: 'Unheard' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', type: 'image/png', href: '/favicon-96x96.png', sizes: '96x96' },
      { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
      { rel: 'shortcut icon', href: '/favicon.ico' },
      { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png' },
      { rel: 'manifest', href: '/site.webmanifest' },
    ],
  }),
  beforeLoad: async ({ location }) => {
    const { isAuthenticated, teamId, email } = await getAuthState();
    const isPublicPath = PUBLIC_PATHS.has(location.pathname);
    if (!isAuthenticated && !isPublicPath) {
      throw redirect({ to: '/login' });
    }
    if (isAuthenticated && !teamId && location.pathname !== '/login' && location.pathname !== '/signup') {
      throw redirect({ to: '/login' });
    }
    return { isAuthenticated, teamId, email };
  },
  loader: async () => {
    const { isAuthenticated } = await getAuthState();
    if (!isAuthenticated) return { posts: [], ideas: [] };
    const [{ getPosts }, { getIdeas }] = await Promise.all([
      import('@/app/server-fns/posts'),
      import('@/app/server-fns/ideas')
    ]);
    const [posts, ideas] = await Promise.all([
      getPosts({ data: {} }),
      getIdeas(),
    ]);
    return { posts, ideas };
  },
  // WorkspaceProvider owns data refreshes after the initial server load.
  // Re-running this seed loader on each route change only causes shell flicker.
  staleTime: Infinity,
  component: RootLayout,
  shellComponent: Shell,
  notFoundComponent: () => (
    <div className="flex items-center justify-center h-full text-[var(--color-text-muted)]">
      Page not found
    </div>
  ),
});

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Toaster richColors position="bottom-right" />
        <Scripts />
      </body>
    </html>
  );
}

function RootLayout() {
  const location = useLocation();
  const { posts, ideas } = Route.useLoaderData();
  const isPublic = PUBLIC_PATHS.has(location.pathname);

  if (isPublic) {
    return (
      <TooltipProvider>
        <Outlet />
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider>
      <WorkspaceProvider
        initialPosts={posts}
        initialIdeas={ideas}
        fetchPosts={async () => {
          const { getPosts } = await import('@/app/server-fns/posts');
          return getPosts({ data: {} });
        }}
        fetchIdeas={async () => {
          const { getIdeas } = await import('@/app/server-fns/ideas');
          return getIdeas();
        }}
      >
        <DashboardHeaderProvider>
          <DashboardLayout />
          <Modals />
        </DashboardHeaderProvider>
      </WorkspaceProvider>
    </TooltipProvider>
  );
}

function DashboardLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { email } = Route.useRouteContext();
  const { setEditingIdea, setIdeaModalOpen, setSelectedIdea } = useWorkspace();
  const { actions: headerActions, breadcrumbSuffix } = useDashboardHeader();
  const pageTitle = getPageTitle(location.pathname);
  const isNewIdeaAssistant = location.pathname === '/ideas' && new URLSearchParams(location.search).get('assistant') === 'new';
  const isFullBleed = location.pathname.startsWith('/posts/') || location.pathname.startsWith('/ideas/') || isNewIdeaAssistant;

  async function handleLogout() {
    await logout();
    window.location.assign('/login');
  }

  function openNewIdea() {
    setSelectedIdea(undefined);
    setEditingIdea(undefined);
    setIdeaModalOpen(false);
    navigate({ to: '/ideas', search: { assistant: 'new' } });
  }

  function openNewPost() {
    navigate({ to: '/posts/$id', params: { id: 'new' }, search: {} });
  }

  const action = location.pathname === '/ideas'
    ? { label: 'New idea', onClick: openNewIdea }
    : location.pathname === '/posts' || location.pathname === '/' || location.pathname === '/calendar'
      ? { label: 'New post', onClick: openNewPost }
      : null;

  return (
    <div className="min-h-screen bg-[var(--color-bg-subtle)] text-[var(--color-text)]">
      <div className="flex h-screen overflow-hidden bg-[var(--color-bg)]">
        <Sidebar />
        <main className="min-w-0 flex-1 overflow-hidden bg-[var(--color-bg)]">
          <div className="flex h-full min-w-0 flex-col">
            <nav aria-label="Mobile navigation" className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-[var(--color-border)] bg-[#10101a] px-3 py-2 text-sm md:hidden">
              <Link to="/dashboard" className="rounded-lg px-3 py-2 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-muted)]">Dashboard</Link>
              <Link to="/posts" search={{ status: 'all' }} className="rounded-lg px-3 py-2 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-muted)]">Posts</Link>
              <Link to="/ideas" className="rounded-lg px-3 py-2 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-muted)]">Ideas</Link>
              <Link to="/calendar" className="rounded-lg px-3 py-2 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-muted)]">Calendar</Link>
              <Link to="/settings" className="rounded-lg px-3 py-2 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-muted)]">Settings</Link>
            </nav>
            <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-[var(--color-border)] px-5 md:px-6">
              <div className="relative w-full max-w-[420px]">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
                <Input aria-label="Search" placeholder="Search for anything" className="h-9 border-transparent bg-transparent pl-9 shadow-none placeholder:text-[var(--color-text-muted)] hover:bg-[var(--color-bg-muted)] focus-visible:bg-[var(--color-bg-elevated)]" />
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {breadcrumbSuffix}
                {headerActions}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Support"
                  title="Support"
                  onClick={() => void userorbit.openWidget({ compact: false, modal: false })}
                >
                  <HelpCircle className="size-[18px]" />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" aria-label="Account menu" className="ml-1 gap-2 px-2 text-[var(--color-text-secondary)]">
                      <span className="grid size-7 place-items-center rounded-full border border-[var(--color-border)] bg-[var(--color-bg-muted)] text-xs font-medium text-[var(--color-text)]">
                        {email?.slice(0, 1).toUpperCase() || 'U'}
                      </span>
                      <span className="hidden max-w-40 truncate sm:inline">{email || 'Account'}</span>
                      <CaretDown className="size-3.5 text-[var(--color-text-muted)]" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuLabel className="max-w-52 truncate">{email || 'Account'}</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <Link to="/settings/setup"><Settings />Setup guide</Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link to="/settings"><Settings />Settings</Link>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => void handleLogout()}>
                      <LogOut />Sign out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </header>

            {isFullBleed ? (
              <div className="min-h-0 flex-1 overflow-hidden bg-[var(--color-bg)]">
                <Outlet />
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-auto bg-[var(--color-bg)]">
                <div className="flex min-h-full w-full flex-col px-5 pb-10 pt-7 md:px-8">
                  <div className="mb-6 flex items-center justify-between gap-4">
                    <h1 className="truncate text-[28px] font-medium leading-9 tracking-tight text-[var(--color-text)]">{pageTitle}</h1>
                    {!headerActions && action ? (
                      <Button size="sm" onClick={action.onClick} className="gap-1.5">
                        <Plus className="size-4" />
                        {action.label}
                      </Button>
                    ) : null}
                  </div>
                  <Outlet />
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

function getPageTitle(pathname: string): string {
  if (pathname === '/posts' || pathname === '/') return 'Posts';
  if (pathname.startsWith('/posts/')) return 'Post editor';
  if (pathname === '/ideas') return 'Ideas';
  if (pathname.startsWith('/ideas/')) return 'Idea details';
  if (pathname === '/calendar') return 'Calendar';
  if (pathname === '/analytics' || pathname === '/dashboard') return 'Dashboard';
  if (pathname === '/settings') return 'Settings';
  if (pathname.startsWith('/settings/setup')) return 'Setup';
  if (pathname.startsWith('/settings/channels')) return 'Channels';
  if (pathname.startsWith('/settings/rss-feeds')) return 'RSS feeds';
  if (pathname.startsWith('/settings/rss')) return 'RSS feeds';
  if (pathname.startsWith('/settings/webhooks')) return 'Webhooks';
  if (pathname.startsWith('/settings/telegram')) return 'Telegram';
  if (pathname.startsWith('/settings/templates-library')) return 'Templates library';
  if (pathname.startsWith('/settings/templates')) return 'Templates';
  if (pathname.startsWith('/settings/best-time')) return 'Best time to post';
  if (pathname.startsWith('/settings/team')) return 'Team';
  if (pathname.startsWith('/settings/brands')) return 'Brand voices';
  if (pathname.startsWith('/settings/notifications')) return 'Notifications';
  return 'Unheard';
}

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: House },
  { href: '/posts', label: 'Posts', icon: FileText },
  { href: '/ideas', label: 'Ideas', icon: Lightbulb },
  { href: '/calendar', label: 'Calendar', icon: CalendarDays },
] as const;

function Sidebar() {
  const location = useLocation();

  const isActive = (href: string) => {
    if (href === '/posts') return location.pathname === '/posts' || location.pathname.startsWith('/posts/') || location.pathname === '/';
    if (href === '/dashboard') return location.pathname === '/dashboard' || location.pathname === '/analytics';
    return location.pathname === href || location.pathname.startsWith(href + '/');
  };

  return (
    <aside className="hidden h-full w-[220px] shrink-0 flex-col border-r border-[var(--color-border)] bg-[#10101a] md:flex">
      <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-[var(--color-border)] px-4">
        <img src="/userorbit-mark-light.svg" alt="" className="size-5 shrink-0" />
        <span className="truncate text-sm font-semibold text-[var(--color-text)]">Unheard</span>
      </div>
      <nav aria-label="Main navigation" className="flex-1 px-2 py-3">
        <div className="space-y-1">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = isActive(href);
            return (
              <Button
                key={href}
                asChild
                variant="ghost"
                size="sm"
                className={cn(
                  'h-8 w-full justify-start gap-2.5 rounded-lg px-2.5 text-sm font-normal',
                  active && 'bg-[rgba(180,183,200,0.12)] text-white hover:bg-[rgba(180,183,200,0.16)]'
                )}
              >
                <Link to={href}>
                  <Icon className={cn('size-[17px]', active ? 'text-white' : 'text-[#a7a8b4]')} />
                  <span className="truncate">{label}</span>
                </Link>
              </Button>
            );
          })}
        </div>
        <div className="my-3 border-t border-[var(--color-border)]" />
        <Button
          asChild
          variant="ghost"
          size="sm"
          className={cn(
            'h-8 w-full justify-start gap-2.5 rounded-lg px-2.5 text-sm font-normal',
            isActive('/settings') && 'bg-[rgba(180,183,200,0.12)] text-white hover:bg-[rgba(180,183,200,0.16)]'
          )}
        >
          <Link to="/settings"><Settings className="size-[17px] text-[#a7a8b4]" /><span>Settings</span></Link>
        </Button>
      </nav>
    </aside>
  );
}

function Modals() {
  const { ideaModalOpen, setIdeaModalOpen, editingIdea, refreshIdeas } = useWorkspace();

  function handleIdeaSaved() {
    setIdeaModalOpen(false);
    refreshIdeas();
  }

  return (
    <IdeaModal
      open={ideaModalOpen}
      onClose={() => setIdeaModalOpen(false)}
      onSaved={handleIdeaSaved}
      existing={editingIdea}
    />
  );
}
