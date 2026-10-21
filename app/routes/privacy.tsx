import { createFileRoute, Link } from '@tanstack/react-router';

export const Route = createFileRoute('/privacy')({
  head: () => ({
    meta: [{ title: 'Privacy Policy | Unheard' }],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 py-12 sm:px-6 sm:py-16">
        <div className="flex flex-col gap-6 border-b border-border pb-8">
          <div className="flex items-center justify-between gap-4">
            <Link to="/" className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
              Unheard
            </Link>
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <Link to="/data-deletion" className="transition-colors hover:text-foreground">
                Data deletion
              </Link>
              <Link to="/terms" className="transition-colors hover:text-foreground">
                Terms
              </Link>
              <Link to="/login" className="transition-colors hover:text-foreground">
                Sign in
              </Link>
            </div>
          </div>
          <div className="space-y-3">
            <p className="text-sm font-medium uppercase tracking-[0.16em] text-muted-foreground">Privacy Policy</p>
            <h1 className="text-4xl font-semibold tracking-tight text-foreground text-balance">
              How Unheard handles your data
            </h1>
            <p className="max-w-2xl text-base leading-7 text-muted-foreground">
              Effective May 2, 2026. This policy explains what information Unheard processes, why we process it, and
              how data moves through features such as scheduling, AI generation, and third-party publishing.
            </p>
          </div>
        </div>

        <div className="space-y-8">
          <LegalSection title="Information we collect">
            <p>
              We process information you provide directly, including account details, workspace settings, drafts,
              scheduled posts, uploaded assets, RSS feed sources, webhook destinations, and support or waitlist
              submissions.
            </p>
          </LegalSection>

          <LegalSection title="Connected account data">
            <p>
              When you connect channels or external tools, Unheard may store the minimum tokens, identifiers, and
              metadata needed to keep those integrations working. This can include social account identifiers, webhook
              endpoints, and AI provider credentials or references to them.
            </p>
          </LegalSection>

          <LegalSection title="How we use information">
            <p>
              We use data to authenticate users, maintain workspaces, generate and edit content, schedule and publish
              posts, send notifications, debug issues, protect the service, and improve the product.
            </p>
          </LegalSection>

          <LegalSection title="AI and third-party processing">
            <p>
              Prompts, drafts, and related context may be sent to third-party providers you enable, such as OpenAI or
              Google Gemini, so requested AI features can operate. Publishing data may also be transmitted to connected
              services such as X, LinkedIn, Telegram, RSS endpoints, and webhook destinations at your direction.
            </p>
          </LegalSection>

          <LegalSection title="Data retention">
            <p>
              We keep workspace data for as long as your account remains active or as needed to provide the service,
              resolve disputes, enforce agreements, and meet legal obligations. Connection tokens may remain stored until
              you revoke or replace them.
            </p>
          </LegalSection>

          <LegalSection title="Security">
            <p>
              We use reasonable administrative, technical, and organizational measures to protect stored data. No method
              of transmission or storage is perfectly secure, so we cannot guarantee absolute security.
            </p>
          </LegalSection>

          <LegalSection title="Your choices">
            <p>
              You can update workspace content, disconnect integrations, and stop using the service at any time. If you
              need help with account data requests, use the product contact channels available inside Unheard.
            </p>
          </LegalSection>

          <LegalSection title="Data deletion requests">
            <p>
              If you want your Unheard workspace data deleted, follow the instructions on our{' '}
              <Link to="/data-deletion" className="text-foreground underline underline-offset-2">
                data deletion page
              </Link>
              . That page explains how to disconnect linked services and submit a deletion request through the support
              channel currently available in the app.
            </p>
          </LegalSection>

          <LegalSection title="International processing">
            <p>
              Depending on the providers you connect, your data may be processed in countries other than your own. By
              using the service, you understand that these transfers may occur as needed to operate the product.
            </p>
          </LegalSection>

          <LegalSection title="Policy updates">
            <p>
              We may update this policy as the product evolves. Material changes will be reflected on this page with an
              updated effective date.
            </p>
          </LegalSection>
        </div>
      </div>
    </div>
  );
}

function LegalSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold tracking-tight text-foreground">{title}</h2>
      <div className="space-y-3 text-sm leading-7 text-muted-foreground sm:text-base">{children}</div>
    </section>
  );
}
