import { createFileRoute, Link, useRouter } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { ArrowRight, CheckCircle2, Circle, RefreshCw } from "@/components/icons";
import { getSetupStatus } from '@/app/server-fns/setup';
import { Button } from '@/components/ui/button';

export const Route = createFileRoute('/settings/setup')({
  loader: () => getSetupStatus(),
  component: SetupPage,
});

const providers = [
  {
    key: 'linkedin',
    label: 'LinkedIn',
    env: 'LINKEDIN_CLIENT_ID · LINKEDIN_CLIENT_SECRET',
    callback: '/linkedin/callback',
    note: 'Create a LinkedIn app with the posting products and permissions your account needs.',
  },
  {
    key: 'meta',
    label: 'Facebook & Instagram',
    env: 'META_APP_ID · META_APP_SECRET',
    callback: '/meta/callback',
    note: 'Create a Meta app with Facebook Login. Instagram publishing needs a professional account linked to a Facebook Page.',
  },
  {
    key: 'youtube',
    label: 'YouTube',
    env: 'YOUTUBE_CLIENT_ID · YOUTUBE_CLIENT_SECRET',
    callback: '/youtube/callback',
    note: 'Enable YouTube Data API v3 and create a Google OAuth web client. Configure its consent screen and test users or publish the app.',
  },
  {
    key: 'reddit',
    label: 'Reddit',
    env: 'REDDIT_CLIENT_ID · REDDIT_CLIENT_SECRET',
    callback: '/reddit/callback',
    note: 'Create an approved Reddit OAuth web app. Set REDDIT_USER_AGENT to identify your deployment.',
  },
] as const;

function Status({
  ready,
  readyLabel = 'Ready',
  pendingLabel = 'Needs setup',
}: {
  ready: boolean;
  readyLabel?: string;
  pendingLabel?: string;
}) {
  const Icon = ready ? CheckCircle2 : Circle;
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-medium ${ready ? 'text-green-700 dark:text-green-400' : 'text-muted-foreground'}`}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {ready ? readyLabel : pendingLabel}
    </span>
  );
}

function SetupPage() {
  const status = Route.useLoaderData();
  const router = useRouter();
  const [origin, setOrigin] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => setOrigin(window.location.origin), []);
  const deploymentUrl = origin || 'https://your-deployment.workers.dev';
  const installCommand = `mkdir -p ~/.codex/skills/content-hub/references\ncurl -fsSL ${deploymentUrl}/skills/content-hub/SKILL.md -o ~/.codex/skills/content-hub/SKILL.md\ncurl -fsSL ${deploymentUrl}/skills/content-hub/references/http-api.md -o ~/.codex/skills/content-hub/references/http-api.md`;

  async function refresh() {
    setRefreshing(true);
    try {
      await router.invalidate();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="w-full min-w-0 space-y-6 [overflow-wrap:anywhere] px-4 py-6 sm:px-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-balance text-xl font-semibold">
            Set up your Content Hub
          </h1>
          <p className="text-pretty text-sm text-muted-foreground">
            Connect your accounts, choose how posts go live, and give your agent
            access to this deployment.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={refresh}
          disabled={refreshing}
          className="min-h-10 shrink-0 gap-2"
        >
          <RefreshCw className={`size-4 ${refreshing ? 'animate-spin' : ''}`} />
          {refreshing ? 'Checking…' : 'Refresh'}
        </Button>
      </div>

      <section
        className="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-panel"
        aria-labelledby="deployment-heading"
      >
        <h2 id="deployment-heading" className="font-semibold">
          1. Check your deployment
        </h2>
        <p className="text-sm text-muted-foreground">
          Add secrets in Cloudflare → your Worker → Settings → Variables and
          Secrets. Save and deploy, then refresh this page. Values stay on the
          server.
        </p>
        <dl className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <dt>
              Session security{' '}
              <code className="text-xs text-muted-foreground">
                SESSION_SECRET
              </code>
            </dt>
            <dd>
              <Status ready={status.session} />
            </dd>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <dt>
              Credential encryption{' '}
              <code className="text-xs text-muted-foreground">
                CREDENTIALS_ENCRYPTION_KEY
              </code>
            </dt>
            <dd>
              <Status ready={status.encryption} />
            </dd>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <dt>Media uploads</dt>
            <dd>
              <Status ready={status.media} />
            </dd>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <dt>
              AI writing{' '}
              <code className="text-xs text-muted-foreground">
                OPENAI_API_KEY
              </code>
            </dt>
            <dd>
              <Status ready={status.ai} pendingLabel="Optional" />
            </dd>
          </div>
        </dl>
        <p className="text-xs text-muted-foreground">
          Use a random session secret of at least 32 characters and a separate
          64-character hexadecimal encryption key. Keep the encryption key
          stable so saved social credentials remain readable. The Cloudflare
          deploy flow provisions your database and media bucket. AI writing is
          optional.
        </p>
      </section>

      <section
        className="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-panel"
        aria-labelledby="channels-heading"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="channels-heading" className="font-semibold">
            2. Connect your socials
          </h2>
          <Status
            ready={status.connected}
            readyLabel="Channel connected"
            pendingLabel="Connect your first channel"
          />
        </div>
        <p className="text-sm text-muted-foreground">
          Configure only the providers you use. Register the exact callback URL
          below in each provider’s developer app, then authorize your account in
          Channels. Provider access, reviews, and API plans may be required.
        </p>
        <div className="divide-y divide-border rounded-xl border border-border">
          {providers.map((provider) => (
            <div key={provider.key} className="space-y-2 p-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-medium">{provider.label}</h3>
                <Status
                  ready={status[provider.key]}
                  readyLabel="App configured"
                  pendingLabel="Optional"
                />
              </div>
              <p className="text-pretty text-xs text-muted-foreground">
                {provider.note}
              </p>
              <p className="break-words font-mono text-xs">{provider.env}</p>
              <code className="block select-all break-all rounded-md bg-muted px-3 py-2 text-xs">
                {origin
                  ? `${origin}${provider.callback}`
                  : `Your deployment URL${provider.callback}`}
              </code>
            </div>
          ))}
          <div className="space-y-2 p-4">
            <h3 className="text-sm font-medium">X / Twitter & Discord</h3>
            <p className="text-pretty text-xs text-muted-foreground">
              Enter your X app’s API key and secret in Channels and allow
              read/write access. Register the X callback below. For Discord,
              enter a webhook URL in Channels.
            </p>
            <code className="block select-all break-all rounded-md bg-muted px-3 py-2 text-xs">
              {origin
                ? `${origin}/twitter/callback`
                : 'Your deployment URL/twitter/callback'}
            </code>
          </div>
        </div>
        <a
          href="/settings/channels"
          className="inline-flex min-h-10 items-center gap-2 text-sm font-medium text-[var(--color-brand)] hover:underline"
        >
          Connect channels <ArrowRight className="size-4" />
        </a>
      </section>

      <section
        className="space-y-3 rounded-2xl border border-border bg-card p-5 shadow-panel"
        aria-labelledby="publishing-heading"
      >
        <h2 id="publishing-heading" className="font-semibold">
          3. Choose how scheduled posts publish
        </h2>
        <p className="text-sm text-muted-foreground">
          Your preference:{' '}
          <strong className="text-foreground">
            {status.autoPublish ? 'Auto-publish enabled' : 'Telegram approval'}
          </strong>
          . The team owner’s preference controls scheduled publishing. Enable
          auto-publish in Notifications to publish due posts automatically.
        </p>
        <p className="text-sm text-muted-foreground">
          For approval before publishing, configure TELEGRAM_BOT_TOKEN,
          TELEGRAM_CHAT_ID, and TELEGRAM_WEBHOOK_SECRET on the Worker. For group
          chats, also set TELEGRAM_APPROVER_USER_ID to the person who can
          approve. Register your bot’s webhook with Telegram at the URL below,
          using the same webhook secret as its secret_token. Send a test
          notification from Notifications. Without auto-publish or working
          Telegram approval, scheduled posts will wait.
        </p>
        <code className="block select-all break-all rounded-xl bg-muted p-3 text-xs">
          {deploymentUrl}/api/telegram/webhook
        </code>
        <Status
          ready={status.telegramApproval}
          readyLabel="Approval settings configured"
          pendingLabel="Approval settings incomplete"
        />
        <p className="text-xs text-muted-foreground">
          These checks confirm that settings exist. A notification test and an
          approval test confirm your bot and webhook can communicate with this
          deployment.
        </p>
        <div>
          <Link
            to="/settings/notifications"
            className="inline-flex min-h-10 items-center gap-2 text-sm font-medium text-[var(--color-brand)] hover:underline"
          >
            Publishing preferences <ArrowRight className="size-4" />
          </Link>
        </div>
      </section>

      <section
        className="space-y-3 rounded-2xl border border-border bg-card p-5 shadow-panel"
        aria-labelledby="agent-heading"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="agent-heading" className="font-semibold">
            4. Connect your agent{' '}
            <span className="font-normal text-muted-foreground">
              (optional)
            </span>
          </h2>
          <Status
            ready={status.apiKey}
            readyLabel="API key created"
            pendingLabel="Create an API key"
          />
        </div>
        <p className="text-sm text-muted-foreground">
          Run these commands to install the skill for Codex, then restart your
          agent. Other agents can use the same skill files in their skills
          directory.
        </p>
        <pre className="overflow-x-auto whitespace-pre rounded-xl bg-muted p-3 text-xs">
          <code className="select-all">{installCommand}</code>
        </pre>
        <p className="text-sm">
          <a
            className="inline-flex min-h-10 items-center text-[var(--color-brand)] hover:underline"
            href="/skills/content-hub/SKILL.md"
            target="_blank"
            rel="noreferrer"
          >
            View skill
          </a>
          <span className="mx-2 text-muted-foreground">·</span>
          <a
            className="inline-flex min-h-10 items-center text-[var(--color-brand)] hover:underline"
            href="/skills/content-hub/references/http-api.md"
            target="_blank"
            rel="noreferrer"
          >
            API reference
          </a>
        </p>
        <p className="text-sm text-muted-foreground">
          Set CONTENT_HUB_BASE_URL to this deployment and CONTENT_HUB_API_KEY to
          a key created in API Keys. Keep your key in your agent’s environment
          or secret store.
        </p>
        <code className="block select-all break-all rounded-xl bg-muted p-3 text-xs">
          CONTENT_HUB_BASE_URL={origin || 'https://your-deployment.workers.dev'}
        </code>
        <p className="text-sm text-muted-foreground">
          For an MCP client, add the remote server below and sign in with this
          Content Hub account.
        </p>
        <code className="block select-all break-all rounded-xl bg-muted p-3 text-xs">
          {origin ? `${origin}/mcp` : 'https://your-deployment.workers.dev/mcp'}
        </code>
        <Link
          to="/settings/api-keys"
          className="inline-flex min-h-10 items-center gap-2 text-sm font-medium text-[var(--color-brand)] hover:underline"
        >
          Manage API keys <ArrowRight className="size-4" />
        </Link>
      </section>

      <Link
        to="/calendar"
        className="inline-flex min-h-10 items-center gap-2 text-sm font-medium text-[var(--color-brand)] hover:underline"
      >
        Open your calendar <ArrowRight className="size-4" />
      </Link>
    </div>
  );
}
