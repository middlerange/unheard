// Shared Slack contracts contain configuration status only, never credentials.
export type SlackSettings = {
  configured: boolean;
  oauthAvailable: boolean;
  workspaceId: string | null;
  channelId: string | null;
  approverUserIds: string[];
  enabled: boolean;
  hasBotToken: boolean;
  hasSigningSecret: boolean;
};

export type SlackOptions = {
  workspaceId: string;
  channels: Array<{
    id: string;
    name: string;
    isPrivate: boolean;
    isMember: boolean;
  }>;
  reviewers: Array<{ id: string; name: string }>;
};
