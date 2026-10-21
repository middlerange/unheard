// ABOUTME: Route the app root to sign-in or the signed-in dashboard.

import { createFileRoute, Link, redirect } from '@tanstack/react-router';
import { CalendarDays, Sparkles, Lightbulb, Users, Clock, LayoutGrid, Check, Github, Server, Key, Bot } from "@/components/icons";
import { getAuthState } from '@/app/server-fns/auth';

export const Route = createFileRoute('/')({
  beforeLoad: async () => {
    const { isAuthenticated } = await getAuthState();
    if (isAuthenticated) throw redirect({ to: '/dashboard' });
    throw redirect({ to: '/login' });
  },
  component: LandingPage,
});

const FEATURES = [
  {
    icon: CalendarDays,
    title: 'Visual calendar',
    description: 'See your entire posting schedule at a glance. Click any date to draft or edit.',
  },
  {
    icon: Sparkles,
    title: 'AI writing assistant',
    description: 'Generate on-brand posts with GPT-4o or Gemini Flash. Set tone, apply brand voice.',
  },
  {
    icon: Lightbulb,
    title: 'Idea to post',
    description: 'Chat with AI to develop ideas. Schedule the best variations in one click.',
  },
  {
    icon: LayoutGrid,
    title: 'Twitter & LinkedIn',
    description: 'Draft platform-specific content simultaneously. Threads, carousels, long-form.',
  },
  {
    icon: Users,
    title: 'Brand voices',
    description: 'Define multiple writing profiles. Keep every post consistent with your brand.',
  },
  {
    icon: Clock,
    title: 'Auto-scheduling',
    description: 'Scheduled posts are checked every minute. Choose auto-publish or Telegram approval.',
  },
  {
    icon: Bot,
    title: 'Agent-ready',
    description: 'Built-in skill lets AI agents ideate, create content, and publish on your behalf.',
  },
];

const MOCK_DRAFTS = [
  { title: 'Most early products struggle with the...', sub: '2d ago' },
  { title: 'Migrating off Next.js and Turborepo h...', sub: 'rewrite in this style · 10d ago' },
  { title: 'We finally ditched Next.js and Turborepo...', sub: 'Announcement · 13d ago' },
  { title: 'I love watching chaos turn into order. We f...', sub: '[Video/Demo] · 14d ago' },
  { title: 'Frameworks can be powerful tools, but th...', sub: '27d ago' },
  { title: 'Teams drown in feedback — Intercom, Sla...', sub: '[Social] · 27d ago' },
];

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DATES = ['02/23', '02/24', '02/25', '02/26', '02/27', '02/28', '03/01'];
const TIMES = ['12:00 PM', '1:00 PM', '2:00 PM', '3:00 PM', '4:00 PM', '5:00 PM', '6:00 PM'];

const CALENDAR_POSTS: Record<string, { platforms: ('x' | 'in')[] }[]> = {
  '0-1': [{ platforms: ['x'] }],
  '1-3': [{ platforms: ['in'] }],
  '2-0': [{ platforms: ['x', 'in'] }],
  '2-5': [{ platforms: ['x'] }],
  '3-2': [{ platforms: ['in'] }],
  '3-6': [{ platforms: ['x', 'in'] }],
  '4-1': [{ platforms: ['in'] }],
  '4-4': [{ platforms: ['x'] }],
  '5-0': [{ platforms: ['in'] }],
  '5-3': [{ platforms: ['x'] }],
  '5-5': [{ platforms: ['in'] }],
  '6-2': [{ platforms: ['x', 'in'] }],
  '6-6': [{ platforms: ['x'] }],
};

function PlatformIcon({ type }: { type: 'x' | 'in' }) {
  return (
    <span className={`text-[9px] font-bold leading-none ${type === 'x' ? 'text-[#1d9bf0]' : 'text-[#0a66c2]'}`}>
      {type === 'x' ? '𝕏' : 'in'}
    </span>
  );
}

function AppMockup() {
  return (
    <div className="rounded-xl border border-border overflow-hidden shadow-[0_4px_24px_rgba(0,0,0,0.06)] select-none text-[11px]">
      <div className="flex h-[340px] bg-background">

        <div className="w-[200px] shrink-0 border-r border-border flex flex-col">
          <div className="px-3 py-2 border-b border-border flex items-center justify-between">
            <div className="size-4 rounded bg-border" />
            <div className="rounded-full bg-foreground text-background px-2.5 py-1 text-[10px] font-medium">+ New post</div>
          </div>
          <div className="px-3 py-1.5 flex gap-1">
            <span className="text-muted-foreground text-[10px]">Ideas <span className="opacity-60">143</span></span>
            <span className="bg-[var(--color-bg-muted)] rounded-full px-2 py-0.5 text-[10px] font-medium text-foreground">Drafts <span className="opacity-60">76</span></span>
            <span className="text-muted-foreground text-[10px]">Queue <span className="opacity-60">15</span></span>
          </div>
          <div className="flex-1 overflow-hidden divide-y divide-border">
            {MOCK_DRAFTS.map((d, i) => (
              <div key={i} className="px-3 py-2">
                <p className="text-[11px] font-medium text-foreground truncate">{d.title}</p>
                <p className="text-[9px] text-muted-foreground truncate mt-0.5">{d.sub}</p>
              </div>
            ))}
          </div>
          <div className="border-t border-border px-3 py-2 flex flex-col gap-1">
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground"><CalendarDays size={12} /> Calendar</div>
          </div>
        </div>

        <div className="flex-1 flex flex-col min-w-0">
          <div className="px-3 py-2 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2 text-[10px] text-foreground font-medium">
              <span className="text-muted-foreground">‹</span>
              02/23/2026 – 03/01/2026
              <span className="text-muted-foreground">›</span>
              <span className="border border-border rounded px-1.5 py-0.5 text-[9px] text-muted-foreground">Today</span>
            </div>
            <div className="flex gap-0.5 rounded-full bg-[var(--color-bg-muted)] p-0.5">
              <span className="rounded-full px-2 py-0.5 text-[9px] text-muted-foreground">Day</span>
              <span className="rounded-full bg-background px-2 py-0.5 text-[9px] font-medium text-foreground shadow-xs">Week</span>
              <span className="rounded-full px-2 py-0.5 text-[9px] text-muted-foreground">Month</span>
            </div>
          </div>

          <div className="grid grid-cols-[40px_repeat(7,1fr)] text-[9px] border-b border-border">
            <div />
            {DAYS.map((day, i) => (
              <div key={day} className="text-center py-1.5 border-l border-border">
                <div className="text-muted-foreground">{day}</div>
                <div className="font-medium text-foreground">{DATES[i]}</div>
              </div>
            ))}
          </div>

          <div className="flex-1 overflow-hidden">
            {TIMES.map((time, row) => (
              <div key={time} className="grid grid-cols-[40px_repeat(7,1fr)] border-b border-border h-[38px]">
                <div className="text-[8px] text-muted-foreground text-right pr-1.5 pt-0.5">{time}</div>
                {Array.from({ length: 7 }).map((_, col) => {
                  const posts = CALENDAR_POSTS[`${row}-${col}`];
                  return (
                    <div key={col} className="border-l border-border px-0.5 pt-0.5 flex flex-col gap-px overflow-hidden">
                      {posts?.map((p, pi) => (
                        <div key={pi} className="flex items-center gap-0.5 rounded bg-[var(--color-bg-muted)] px-1 py-px">
                          <div className="size-1.5 rounded-full bg-border shrink-0" />
                          <div className="flex gap-0.5 ml-auto">
                            {p.platforms.map((pl, pli) => <PlatformIcon key={pli} type={pl} />)}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}

function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto flex w-full max-w-2xl flex-col px-4">

        <div className="flex flex-col items-center justify-center gap-8 py-16 text-center sm:py-20">
          <div className="flex flex-col items-center gap-3">
            <img src="/userorbit-mark-light.svg" alt="Userorbit" className="size-14 select-none" draggable={false} />
            <h1 className="text-3xl font-bold tracking-tight text-foreground text-pretty max-w-sm">
              Unheard
            </h1>
            <p className="text-3xl font-medium tracking-tight text-muted-foreground text-pretty max-w-sm">
              AI-powered scheduling for Twitter and LinkedIn.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              to="/signup"
              className="inline-flex items-center justify-center rounded-full bg-foreground text-background px-5 py-2.5 text-[15px] font-medium shadow-lg hover:opacity-90 transition-opacity"
            >
              Create account
            </Link>
            <Link
              to="/login"
              className="inline-flex items-center justify-center rounded-full border border-border bg-background text-foreground px-5 py-2.5 text-[15px] font-medium hover:bg-accent transition-colors"
            >
              Log in
            </Link>
          </div>
        </div>

        <div className="pb-16">
          <AppMockup />
        </div>

        <div className="flex flex-col gap-10 py-8 sm:py-12">
          <div className="flex flex-col">
            <h2 className="text-2xl font-medium text-foreground">Everything you need.</h2>
            <p className="text-2xl font-medium text-muted-foreground">Built for solo creators.</p>
          </div>
          <div className="grid grid-cols-1 gap-x-8 gap-y-10 sm:grid-cols-2 sm:gap-y-12">
            {FEATURES.map(({ icon: Icon, title, description }) => (
              <div key={title} className="flex flex-col gap-4">
                <div className="flex size-8 items-center justify-center text-muted-foreground">
                  <Icon size={24} />
                </div>
                <div className="flex flex-col">
                  <h3 className="text-lg font-medium text-foreground">{title}</h3>
                  <p className="text-lg font-medium text-muted-foreground text-pretty">{description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-10 py-12 sm:py-16 border-t border-border">
          <div className="flex flex-col">
            <h2 className="text-2xl font-medium text-foreground">Own it forever.</h2>
            <p className="text-2xl font-medium text-muted-foreground">Open source. Self-hosted. MIT licensed.</p>
          </div>

          <div className="rounded-2xl border border-border p-8 flex flex-col gap-8">
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium text-muted-foreground">MIT license</p>
              <div className="flex items-baseline gap-1">
                <span className="text-5xl font-semibold tracking-tight text-foreground">Open source</span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              <div className="flex flex-col gap-2">
                <div className="flex size-8 items-center justify-center text-muted-foreground">
                  <Server size={20} />
                </div>
                <p className="text-sm font-medium text-foreground">Self-hosted on Cloudflare</p>
                <p className="text-sm text-muted-foreground">Deploy to your own Cloudflare account with the deploy button. Your data stays yours.</p>
              </div>
              <div className="flex flex-col gap-2">
                <div className="flex size-8 items-center justify-center text-muted-foreground">
                  <Key size={20} />
                </div>
                <p className="text-sm font-medium text-foreground">Bring your own AI keys</p>
                <p className="text-sm text-muted-foreground">Connect your OpenAI or Gemini API keys. Pay only for what you use.</p>
              </div>
              <div className="flex flex-col gap-2">
                <div className="flex size-8 items-center justify-center text-muted-foreground">
                  <Github size={20} />
                </div>
                <p className="text-sm font-medium text-foreground">Full source access</p>
                <p className="text-sm text-muted-foreground">Use, modify, and share the source under the MIT license.</p>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 text-sm text-foreground">
                <Check size={16} className="text-emerald-500 shrink-0" />
                Connect Twitter and LinkedIn accounts
              </div>
              <div className="flex items-center gap-2 text-sm text-foreground">
                <Check size={16} className="text-emerald-500 shrink-0" />
                Install the agent skill for your own deployment
              </div>
              <div className="flex items-center gap-2 text-sm text-foreground">
                <Check size={16} className="text-emerald-500 shrink-0" />
                Cloudflare, AI, and social API usage is billed by your providers
              </div>
              <div className="flex items-center gap-2 text-sm text-foreground">
                <Check size={16} className="text-emerald-500 shrink-0" />
                Manage your own accounts and API credentials
              </div>
            </div>

            <Link
              to="/signup"
              className="inline-flex items-center justify-center rounded-full bg-foreground text-background px-5 py-2.5 text-[15px] font-medium shadow-lg hover:opacity-90 transition-opacity w-full sm:w-auto sm:self-start"
            >
              Create account
            </Link>
          </div>
        </div>

        <div className="flex flex-col items-center gap-3 border-t border-border py-12 text-center">
          <div className="flex items-center gap-5 text-sm text-muted-foreground">
            <Link to="/terms" className="transition-colors hover:text-foreground">
              Terms
            </Link>
            <Link to="/privacy" className="transition-colors hover:text-foreground">
              Privacy
            </Link>
            <Link to="/login" className="transition-colors hover:text-foreground">
              Sign in
            </Link>
          </div>
          <p className="text-xs text-muted-foreground">
            By creating an account or signing in, you agree to the Terms of Service and Privacy Policy.
          </p>
        </div>

      </div>

    </div>
  );
}
