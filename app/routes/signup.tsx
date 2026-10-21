// ABOUTME: Signup page — create account with team.
// ABOUTME: Opens the setup guide after creating an account.

import { createFileRoute, redirect, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getAuthState, signup } from '@/app/server-fns/auth';

export const Route = createFileRoute('/signup')({
  beforeLoad: async () => {
    const { isAuthenticated } = await getAuthState();
    if (isAuthenticated) {
      throw redirect({ to: '/settings/setup' });
    }
  },
  component: SignupPage,
});

function SignupPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    teamName: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await signup({ data: form });
      await router.navigate({ to: '/settings/setup' });
      await router.invalidate();
    } catch (err) {
      console.error('[signup] error:', err);
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg || 'Failed to create account');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center justify-center h-screen bg-background">
      <div className="w-full max-w-sm space-y-6 p-8 border border-border rounded-lg bg-card">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-bold tracking-tight">Create your account</h1>
          <p className="text-sm text-muted-foreground">Get started with Unheard</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Full Name</Label>
            <Input
              id="name"
              type="text"
              value={form.name}
              onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
              required
              autoFocus
              placeholder="John Doe"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={form.email}
              onChange={(e) => setForm(prev => ({ ...prev, email: e.target.value }))}
              required
              placeholder="you@example.com"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={form.password}
              onChange={(e) => setForm(prev => ({ ...prev, password: e.target.value }))}
              required
              placeholder="At least 8 characters"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="teamName">Team Name</Label>
            <Input
              id="teamName"
              type="text"
              value={form.teamName}
              onChange={(e) => setForm(prev => ({ ...prev, teamName: e.target.value }))}
              required
              placeholder="Your Team"
            />
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Creating account…' : 'Create account'}
          </Button>
        </form>

        <div className="text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <a href="/login" className="text-[var(--color-brand)] hover:underline">
            Sign in
          </a>
        </div>
        <div className="text-center text-xs text-muted-foreground">
          By creating an account, you agree to our{' '}
          <a href="/terms" className="hover:text-foreground hover:underline">Terms of Service</a>
          {' '}and{' '}
          <a href="/privacy" className="hover:text-foreground hover:underline">Privacy Policy</a>.
        </div>
      </div>
    </div>
  );
}
