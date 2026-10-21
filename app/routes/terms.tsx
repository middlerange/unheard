import { createFileRoute, Link } from '@tanstack/react-router';

export const Route = createFileRoute('/terms')({
  head: () => ({
    meta: [{ title: 'Terms of Service | Unheard' }],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <LegalPage
      eyebrow="Terms of Service"
      title="Terms for using Unheard"
      description="Effective May 2, 2026. These terms govern your access to Unheard, including the hosted app, APIs, AI-assisted workflows, and connected publishing features."
    >
      <LegalSection title="Use of the service">
        <p>
          You may use Unheard to draft, organize, and publish content for accounts you own or are authorized to manage.
          You are responsible for the content you create, the destinations you publish to, and compliance with the rules
          of any connected platform.
        </p>
      </LegalSection>

      <LegalSection title="Accounts and access">
        <p>
          Keep your login credentials, API keys, and third-party connection tokens secure. You are responsible for
          activity that happens through your workspace, including actions taken by team members you invite.
        </p>
      </LegalSection>

      <LegalSection title="AI-generated content">
        <p>
          Unheard can help generate ideas, drafts, rewrites, and scheduling suggestions. You must review outputs before
          publishing. We do not guarantee factual accuracy, originality, legal compliance, or platform performance for
          AI-generated content.
        </p>
      </LegalSection>

      <LegalSection title="Connected services">
        <p>
          Features that connect to services such as X, LinkedIn, OpenAI, Gemini, Telegram, RSS providers, and webhooks
          depend on those third parties remaining available. Their terms, rate limits, and policies continue to apply to
          your use of those integrations.
        </p>
      </LegalSection>

      <LegalSection title="Acceptable use">
        <p>
          You may not use Unheard to break the law, infringe another party&apos;s rights, send spam, distribute malware,
          interfere with the service, or attempt unauthorized access to any workspace, account, or connected platform.
        </p>
      </LegalSection>

      <LegalSection title="Ownership">
        <p>
          You retain ownership of the content, prompts, assets, and workspace data you submit to Unheard. We retain
          ownership of the software, product design, and related intellectual property that power the service.
        </p>
      </LegalSection>

      <LegalSection title="Availability and changes">
        <p>
          We may update, improve, suspend, or remove features at any time. We aim for a reliable service, but Unheard is
          provided on an as-available basis and may experience downtime, bugs, or third-party outages.
        </p>
      </LegalSection>

      <LegalSection title="Termination">
        <p>
          We may suspend or terminate access if your use creates security risk, violates these terms, or exposes us or
          other users to harm. You may stop using the service at any time.
        </p>
      </LegalSection>

      <LegalSection title="Disclaimers and liability">
        <p>
          To the maximum extent permitted by law, Unheard is provided without warranties of merchantability, fitness for
          a particular purpose, or non-infringement. We are not liable for indirect, incidental, special, consequential,
          or punitive damages, or for lost profits, revenue, data, goodwill, or publishing opportunities.
        </p>
      </LegalSection>

      <LegalSection title="Contact">
        <p>
          Questions about these terms can be sent through the product contact channels made available inside Unheard.
        </p>
      </LegalSection>
    </LegalPage>
  );
}

function LegalPage({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 py-12 sm:px-6 sm:py-16">
        <div className="flex flex-col gap-6 border-b border-border pb-8">
          <div className="flex items-center justify-between gap-4">
            <Link to="/" className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
              Unheard
            </Link>
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <Link to="/privacy" className="transition-colors hover:text-foreground">
                Privacy
              </Link>
              <Link to="/login" className="transition-colors hover:text-foreground">
                Sign in
              </Link>
            </div>
          </div>
          <div className="space-y-3">
            <p className="text-sm font-medium uppercase tracking-[0.16em] text-muted-foreground">{eyebrow}</p>
            <h1 className="text-4xl font-semibold tracking-tight text-foreground text-balance">{title}</h1>
            <p className="max-w-2xl text-base leading-7 text-muted-foreground">{description}</p>
          </div>
        </div>

        <div className="space-y-8">{children}</div>
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
