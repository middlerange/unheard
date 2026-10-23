// ABOUTME: Settings landing page — lists all available settings sections.
// ABOUTME: Entry point for /settings, links out to each sub-section.

import { createFileRoute, Link } from '@tanstack/react-router';
import { ChevronRight, Mic2, FileText, Bell, Radio, Rss, Webhook, Users, Send, Clock, KeyRound, ListChecks, MessageSquare } from "@/components/icons";

export const Route = createFileRoute('/settings/')({
  component: SettingsPage,
});

const sections = [
  {
    to: '/settings/setup',
    icon: ListChecks,
    label: 'Setup guide',
    description: 'Deployment checks, social connections, publishing, and agent access',
  },
  {
    to: '/settings/channels',
    icon: Radio,
    label: 'Channels',
    description: 'Twitter, LinkedIn, Discord, Reddit, Telegram accounts',
  },
  {
    to: '/settings/rss',
    icon: Rss,
    label: 'RSS Feeds',
    description: 'Auto-post from RSS, YouTube, and podcast feeds',
  },
  {
    to: '/settings/webhooks',
    icon: Webhook,
    label: 'Webhooks',
    description: 'Outgoing webhooks for Zapier, Make, n8n integrations',
  },
  {
    to: '/settings/research',
    icon: Clock,
    label: 'Research schedule',
    description: 'Set the daily research time and timezone, or pause automatic scans',
  },
  {
    to: '/settings/research-profiles',
    icon: Mic2,
    label: 'Research profiles',
    description: 'Choose which profiles get daily drafts and set their individual writing instructions',
  },
  {
    to: '/settings/slack',
    icon: MessageSquare,
    label: 'Slack approvals',
    description: 'Review daily research drafts, request edits in a thread, and approve publishing',
  },
  {
    to: '/settings/telegram',
    icon: Send,
    label: 'Telegram',
    description: 'Connect Telegram bots for channel posting',
  },
  {
    to: '/settings/templates-library',
    icon: FileText,
    label: 'Templates Library',
    description: 'Pre-built and custom post templates',
  },
  {
    to: '/settings/best-time',
    icon: Clock,
    label: 'Best Time to Post',
    description: 'AI-suggested optimal posting times',
  },
  {
    to: '/settings/team',
    icon: Users,
    label: 'Team',
    description: 'Manage team members and collaboration',
  },
  {
    to: '/settings/api-keys',
    icon: KeyRound,
    label: 'API Keys',
    description: 'Create keys for agents and external integrations',
  },
  {
    to: '/settings/brands',
    icon: Mic2,
    label: 'Brand Voices',
    description: 'Customize AI writing style and tone per brand',
  },
  {
    to: '/settings/notifications',
    icon: Bell,
    label: 'Notifications',
    description: 'Scheduled auto-publishing and Telegram alerts',
  },
] as const;

function SettingsPage() {
  return (
    <div className="space-y-4">
      <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card shadow-panel">
        {sections.map(({ to, icon: Icon, label, description }) => (
          <Link
            key={to}
            to={to}
            className="surface-gradient flex items-center gap-4 px-5 py-4 transition-colors hover:bg-[var(--color-bg-muted)]"
          >
            <Icon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{label}</p>
              <p className="text-xs text-muted-foreground">{description}</p>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          </Link>
        ))}
      </div>
    </div>
  );
}
