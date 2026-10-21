// ABOUTME: Telegram settings page — manage Telegram bot channels (Issue #10)
// ABOUTME: Configure Telegram bot tokens and channel targets

import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Plus, Trash2, ChevronLeft, Send, Bot, CheckCircle2, AlertCircle, MessageCircle } from "@/components/icons";
import { cn } from '@/lib/utils';
import { testTelegramBot, addTelegramChannel, listTelegramChannels, deleteTelegramChannel } from '@/app/server-fns/telegram-platform';

export const Route = createFileRoute('/settings/telegram')({
  loader: () => listTelegramChannels(),
  component: TelegramSettings,
});

function TelegramSettings() {
  const initialChannels = Route.useLoaderData();
  const [channels, setChannels] = useState(initialChannels);
  const [isAdding, setIsAdding] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{success: boolean; message: string} | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  
  // Form state
  const [newChannel, setNewChannel] = useState({
    name: '',
    channelId: '',
    botToken: '',
    threadId: '',
  });

  async function refresh() {
    setChannels(await listTelegramChannels());
  }

  const handleTestBot = async () => {
    if (!newChannel.botToken.trim()) {
      toast.error('Please enter a bot token');
      return;
    }
    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await testTelegramBot({ data: { botToken: newChannel.botToken } });
      setTestResult({
        success: true,
        message: `Bot validated: @${result.bot.username} (${result.bot.name})`,
      });
    } catch (error) {
      setTestResult({
        success: false,
        message: error instanceof Error ? error.message : 'Bot validation failed',
      });
    }
    setIsTesting(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChannel.name.trim() || !newChannel.channelId.trim() || !newChannel.botToken.trim()) {
      toast.error('Please fill in all required fields');
      return;
    }
    
    setIsSaving(true);
    try {
      await addTelegramChannel({
        data: {
          name: newChannel.name,
          channelId: newChannel.channelId,
          botToken: newChannel.botToken,
          threadId: newChannel.threadId || undefined,
        },
      });
      setIsAdding(false);
      setNewChannel({ name: '', channelId: '', botToken: '', threadId: '' });
      setTestResult(null);
      toast.success('Telegram channel added successfully');
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to add channel');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Remove this Telegram channel?')) return;
    
    setIsDeleting(id);
    try {
      await deleteTelegramChannel({ data: { id } });
      toast.success('Channel removed');
      await refresh();
    } catch {
      toast.error('Failed to remove channel');
    } finally {
      setIsDeleting(null);
    }
  };

  return (
    <div className="w-full px-6 py-6">
      {/* Header */}
      <div className="flex items-center gap-2 mb-6">
        <Link to="/settings" className="text-muted-foreground hover:text-foreground transition-colors">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-xl font-semibold">Telegram</h1>
      </div>

      <p className="text-muted-foreground mb-6">
        Connect Telegram bots to post to channels and groups. Supports rich Markdown formatting.
      </p>

      {/* Channel List */}
      {channels.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <Bot className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">
              No Telegram channels configured yet.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Add a bot to post to Telegram channels and groups.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4 mb-6">
          {channels.map((channel: any) => (
            <Card key={channel.id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-[#0088cc]/10 flex items-center justify-center">
                      <Send className="w-5 h-5 text-[#0088cc]" />
                    </div>
                    <div>
                      <CardTitle className="text-base">{channel.name}</CardTitle>
                      <CardDescription className="text-xs font-mono">
                        {channel.channel_id}
                        {channel.thread_id && <span className="ml-2 text-muted-foreground">(topic: {channel.thread_id})</span>}
                      </CardDescription>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(channel.id)}
                    disabled={isDeleting === channel.id}
                  >
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Bot className="w-3 h-3" />
                    Bot: {channel.bot_token}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add Channel Form */}
      {isAdding ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Bot className="w-4 h-4" />
              Add Telegram Channel
            </CardTitle>
            <CardDescription>
              Configure a Telegram bot to post to your channel or group.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Channel Name (for your reference)</Label>
                <Input
                  id="name"
                  value={newChannel.name}
                  onChange={(e) => setNewChannel({ ...newChannel, name: e.target.value })}
                  placeholder="My Telegram Channel"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="botToken">Bot Token</Label>
                <div className="flex gap-2">
                  <Input
                    id="botToken"
                    type="password"
                    value={newChannel.botToken}
                    onChange={(e) => {
                      setNewChannel({ ...newChannel, botToken: e.target.value });
                      setTestResult(null);
                    }}
                    placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
                    required
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleTestBot}
                    disabled={isTesting || !newChannel.botToken}
                  >
                    {isTesting ? 'Testing...' : 'Test Bot'}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Get this from @BotFather on Telegram. Format: numbers:alphanumeric
                </p>
                {testResult && (
                  <div className={cn(
                    'flex items-center gap-2 text-sm p-2 rounded',
                    testResult.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                  )}>
                    {testResult.success ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                    {testResult.message}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="channelId">Channel ID or Username</Label>
                <Input
                  id="channelId"
                  value={newChannel.channelId}
                  onChange={(e) => setNewChannel({ ...newChannel, channelId: e.target.value })}
                  placeholder="@mychannel or -1001234567890"
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Use @channelname for public channels, or the numeric ID for private channels. 
                  Make sure the bot is an admin in the channel.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="threadId">Topic ID (optional)</Label>
                <Input
                  id="threadId"
                  value={newChannel.threadId}
                  onChange={(e) => setNewChannel({ ...newChannel, threadId: e.target.value })}
                  placeholder="123"
                />
                <p className="text-xs text-muted-foreground">
                  For posting to specific topics in forum-style groups
                </p>
              </div>

              <div className="bg-muted/50 rounded-md p-3 text-sm space-y-2">
                <p className="font-medium flex items-center gap-2">
                  <MessageCircle className="w-4 h-4" />
                  Setup Instructions:
                </p>
                <ol className="text-muted-foreground list-decimal list-inside space-y-1 text-xs">
                  <li>Message @BotFather on Telegram to create a new bot</li>
                  <li>Copy the bot token (looks like 123456:ABC-DEF...)</li>
                  <li>Add your bot as an admin to your channel/group</li>
                  <li>For private channels, forward a message to @userinfobot to get the channel ID</li>
                  <li>Paste the channel ID above (starts with -100 for private channels)</li>
                </ol>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setIsAdding(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isSaving}>
                  {isSaving ? 'Adding...' : 'Add Channel'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : (
        <Button onClick={() => setIsAdding(true)} className="gap-2">
          <Plus className="w-4 h-4" />
          Add Telegram Channel
        </Button>
      )}
    </div>
  );
}
