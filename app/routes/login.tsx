// ABOUTME: Login page — email + password form for single-user auth.
// ABOUTME: Redirects to the dashboard after authentication.

import { createFileRoute, redirect } from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getAuthState, login } from '@/app/server-fns/auth';
import { safeLocalRedirect } from '@/lib/mcp/oauth';

export const Route = createFileRoute('/login')({
  validateSearch: z.object({ redirect: z.string().optional() }),
  beforeLoad: async ({ search }) => {
    const { isAuthenticated, teamId } = await getAuthState();
    if (isAuthenticated && teamId) {
      if (search.redirect) throw redirect({ href: safeLocalRedirect(search.redirect) });
      throw redirect({ to: '/dashboard' });
    }
  },
  component: LoginPage,
});

function LoginPage() {
  const { redirect: returnTo } = Route.useSearch();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login({ data: { email, password } });
      window.location.assign(returnTo ? safeLocalRedirect(returnTo) : '/dashboard');
    } catch (err) {
      console.error('[login] error:', err);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.startsWith('Failed query:') || msg.includes('D1 HTTP API error')) {
        setError('Could not connect to the development database. Restart the local app and try again.');
      } else if (msg === 'Failed to fetch' || err instanceof TypeError) {
        setError('Could not reach the app server. Refresh the page and try again.');
      } else {
        setError(msg || 'Unable to sign in. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center justify-center h-screen bg-background">
      <div className="w-full max-w-sm space-y-6 p-8 border border-border rounded-lg bg-card">
        <div className="space-y-1 text-center">
          <h1 className="flex items-center justify-center gap-2 text-2xl font-bold tracking-tight"><img src="/userorbit-mark-light.svg" alt="" className="size-5" />Unheard</h1>
          <p className="text-sm text-muted-foreground">Sign in to continue</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
        <div className="text-center text-sm text-muted-foreground">
          Don't have an account?{' '}
          <a href="/signup" className="text-[var(--color-brand)] hover:underline">
            Sign up
          </a>
        </div>
        <div className="text-center text-xs text-muted-foreground">
          <a href="/terms" className="hover:text-foreground hover:underline">Terms</a>
          {' · '}
          <a href="/privacy" className="hover:text-foreground hover:underline">Privacy</a>
        </div>
      </div>
    </div>
  );
}
