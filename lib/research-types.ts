// Shared research API contracts; secrets and fetched article bodies stay server-side.
export type ResearchSourceSeed = {
  id: string;
  name: string;
  url: string;
  feedUrl?: string;
  kind: "rss" | "web" | "youtube" | "community";
  category:
    "practitioner" | "research" | "competitor" | "community" | "youtube";
  author?: string;
  enabled: boolean;
  notes: string;
  priority: 1 | 2 | 3;
  channelId?: string;
};
export type ResearchSource = ResearchSourceSeed & {
  lastCollectedAt: number | null;
  lastError: string | null;
  itemCount: number;
};
export type ResearchRun = {
  id: string;
  mode: "scan" | "collect" | "test";
  status:
    "queued" | "collecting" | "ranking" | "drafting" | "completed" | "failed";
  days: number;
  editorial: boolean;
  createdAt: number;
  completedAt: number | null;
  sourceCount: number;
  collectedCount: number;
  findingsCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheHits: number;
  error: string | null;
};
export type ResearchFinding = {
  id: string;
  runId: string;
  itemId: string;
  sourceId: string;
  sourceName: string;
  title: string;
  url: string;
  publishedAt: number;
  score: number;
  summary: string;
  whyItMatters: string;
  contentAngle: string;
  evidence: string;
  limitations: string;
  status: "new" | "saved" | "dismissed";
  ideaId: string | null;
  createdAt: number;
  contentType: "article" | "video";
  transcriptStatus: "available" | "unavailable" | "not_applicable";
};
export type ResearchSnapshot = {
  configured: boolean;
  workflowConfigured: boolean;
  model: string;
  settings: {
    icp: string;
    dailyEnabled: boolean;
    dailyTime: string | null;
    dailyTimezone: string;
    nextDailyAt: number | null;
  };
  sources: ResearchSource[];
  runs: ResearchRun[];
  findings: ResearchFinding[];
  drafts: ResearchDraft[];
};
export type ResearchJob = {
  operation: "plan" | "collect" | "rank" | "drafts" | "fail" | "daily";
  runId?: string;
  sourceId?: string;
  error?: string;
  scheduledTime?: number;
};

export type ResearchDraftContent = {
  targets: Array<{
    channelId: string;
    channelName?: string;
    platform: string;
    content: string;
    thread: string[];
    redditTitle?: string;
    subreddit?: string;
    redditPostType?: "self";
  }>;
};
export type ResearchDraft = {
  id: string;
  runId: string;
  findingId: string;
  title: string;
  sourceUrl: string;
  whyItMatters: string;
  content: ResearchDraftContent;
  revision: number;
  isTest: boolean;
  status:
    | "draft"
    | "delivering"
    | "pending"
    | "editing"
    | "approved_test"
    | "approved"
    | "rejected"
    | "publishing"
    | "published"
    | "failed";
  postId: string | null;
  slackChannelId: string | null;
  slackThreadTs: string | null;
  slackThreadUrl: string | null;
  createdAt: number;
  updatedAt: number;
  error: string | null;
};
