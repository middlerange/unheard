import { createFileRoute, Link } from '@tanstack/react-router';

export const Route = createFileRoute('/data-deletion')({
  head: () => ({
    meta: [{ title: 'Data Deletion Instructions | Unheard' }],
  }),
  component: DataDeletionPage,
});

function DataDeletionPage() {
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
              <Link to="/terms" className="transition-colors hover:text-foreground">
                Terms
              </Link>
              <Link to="/login" className="transition-colors hover:text-foreground">
                Sign in
              </Link>
            </div>
          </div>
          <div className="space-y-3">
            <p className="text-sm font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Data Deletion Instructions
            </p>
            <h1 className="text-4xl font-semibold tracking-tight text-foreground text-balance">
              How to request deletion of your Unheard data
            </h1>
            <p className="max-w-2xl text-base leading-7 text-muted-foreground">
              This page explains how Unheard users can request deletion of workspace data associated with their account.
            </p>
          </div>
        </div>

        <div className="space-y-8">
          <LegalSection title="If you can still sign in">
            <p>
              1. Sign in to your Unheard account.
            </p>
            <p>
              2. Review the integrations and stored content tied to your workspace.
            </p>
            <p>
              3. If you want linked publishing credentials removed immediately, open Settings and disconnect or remove any
              channels, feeds, webhooks, or related integrations you no longer want connected.
            </p>
            <p>
              4. Use the Support button in the Unheard sidebar and send a request that clearly says you want your account
              and workspace data deleted.
            </p>
            <p>
              5. Include the email address on the account and, if relevant, your workspace or team name so the request
              can be matched correctly.
            </p>
          </LegalSection>

          <LegalSection title="If you cannot sign in">
            <p>
              If you no longer have access to the product, use the same contact channel through which you received access
              to Unheard and request account deletion. Include the email address associated with your account and any
              identifying workspace details you have available.
            </p>
          </LegalSection>

          <LegalSection title="What we delete">
            <p>
              Once a deletion request is verified and processed, Unheard will remove the workspace data associated with
              your account, including stored drafts, scheduled content, connected channel records, and related workspace
              metadata, except where retention is required for security, fraud prevention, or legal compliance.
            </p>
          </LegalSection>

          <LegalSection title="Processing time">
            <p>
              Requests are handled manually. We aim to process verified deletion requests within a reasonable timeframe and
              may contact you if we need more information to confirm ownership of the account.
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
