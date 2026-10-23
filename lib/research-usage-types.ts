export type ResearchUsageStage = 'research' | 'draft_generation' | 'slack_revision' | 'legacy';

export type ResearchUsageTotals = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  requestCount: number;
  estimatedRequests: number;
  unknownRequests: number;
};

export type ResearchStageUsage = ResearchUsageTotals & { stage: ResearchUsageStage };
export type ResearchRunUsage = ResearchUsageTotals & {
  runId: string;
  createdAt: number;
  mode: string;
  days: number;
  status: string;
  stages: ResearchStageUsage[];
};

export type ResearchUsageSummary = {
  timezone: string;
  currency: 'USD';
  today: ResearchUsageTotals;
  month: ResearchUsageTotals;
  allTime: ResearchUsageTotals;
  stages: { today: ResearchStageUsage[]; month: ResearchStageUsage[]; allTime: ResearchStageUsage[] };
  daily: (ResearchUsageTotals & { date: string })[];
  monthly: (ResearchUsageTotals & { month: string })[];
  runs: ResearchRunUsage[];
  pricingUrl: string;
  pricingAsOf: string;
  trackingStartedAt: number | null;
  historyNote: string;
};
