// ABOUTME: Team settings page — manage team members and invites (Issue #9)

import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Plus, ChevronLeft, UserMinus } from "@/components/icons";
import { cn } from '@/lib/utils';
import type { TeamMember } from '@/lib/db/types';
import { getTeamMembersList, inviteTeamMember, removeTeamMemberFn } from '@/app/server-fns/team-collaboration';

export const Route = createFileRoute('/settings/team')({
  loader: () => getTeamMembersList(),
  component: TeamSettings,
});

const ROLES = [
  { value: 'owner', label: 'Owner', description: 'Full access to everything' },
  { value: 'admin', label: 'Admin', description: 'Can manage team and posts' },
  { value: 'editor', label: 'Editor', description: 'Can create and edit posts' },
  { value: 'viewer', label: 'Viewer', description: 'Can view and comment only' },
] as const;

function TeamSettings() {
  const initialMembers = Route.useLoaderData();
  const [members, setMembers] = useState<TeamMember[]>(initialMembers);
  const [isInviting, setIsInviting] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'editor' | 'viewer'>('editor');
  const [isSending, setIsSending] = useState(false);
  const [isRemoving, setIsRemoving] = useState<string | null>(null);

  async function refresh() {
    setMembers(await getTeamMembersList());
  }

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    
    setIsSending(true);
    try {
      const data = await inviteTeamMember({ data: { email: inviteEmail, role: inviteRole } });
      setIsInviting(false);
      setInviteEmail('');
      toast.success('Invite sent!');
      if (data.inviteUrl) {
        console.log('Invite URL:', data.inviteUrl);
      }
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to send invite');
    } finally {
      setIsSending(false);
    }
  };

  const handleRemove = async (userId: string) => {
    if (!confirm('Remove this team member?')) return;
    
    setIsRemoving(userId);
    try {
      await removeTeamMemberFn({ data: { userId } });
      toast.success('Member removed');
      await refresh();
    } catch {
      toast.error('Failed to remove member');
    } finally {
      setIsRemoving(null);
    }
  };

  return (
    <div className="w-full px-6 py-6">
      {/* Header */}
      <div className="flex items-center gap-2 mb-6">
        <Link to="/settings" className="text-muted-foreground hover:text-foreground transition-colors">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-xl font-semibold">Team</h1>
      </div>

      <p className="text-muted-foreground mb-6">
        Invite team members and manage permissions.
      </p>

      {/* Member List */}
      <div className="space-y-4 mb-6">
        {members.map((member: TeamMember) => (
          <Card key={member.user_id}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-[var(--color-brand)] font-medium">
                    {member.user_name?.[0]?.toUpperCase() || member.user_email[0].toUpperCase()}
                  </div>
                  <div>
                    <p className="font-medium">{member.user_name || member.user_email}</p>
                    <p className="text-xs text-muted-foreground">{member.user_email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={member.role === 'owner' ? 'default' : 'secondary'}>
                    {member.role}
                  </Badge>
                  {member.role !== 'owner' && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemove(member.user_id)}
                      disabled={isRemoving === member.user_id}
                    >
                      <UserMinus className="w-4 h-4 text-destructive" />
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Invite Form */}
      {isInviting ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Invite Team Member</CardTitle>
            <CardDescription>
              Send an invite to join your team.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleInvite} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email Address</Label>
                <Input
                  id="email"
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="colleague@example.com"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label>Role</Label>
                <div className="grid grid-cols-3 gap-2">
                  {ROLES.filter(r => r.value !== 'owner').map((role) => (
                    <button
                      key={role.value}
                      type="button"
                      onClick={() => setInviteRole(role.value as typeof inviteRole)}
                      className={cn(
                        'p-3 rounded-md border text-left transition-colors',
                        inviteRole === role.value
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:bg-accent'
                      )}
                    >
                      <p className="text-sm font-medium">{role.label}</p>
                      <p className="text-xs text-muted-foreground">{role.description}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setIsInviting(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isSending}>
                  {isSending ? 'Sending...' : 'Send Invite'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : (
        <Button onClick={() => setIsInviting(true)} className="gap-2">
          <Plus className="w-4 h-4" />
          Invite Member
        </Button>
      )}
    </div>
  );
}
