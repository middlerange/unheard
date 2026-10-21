type Entry = {
  key: string;
  id: string;
  group: 'personal' | 'company';
  publishAt: number;
  linkedin: string;
  twitter: string;
  twitterThread?: string[];
  asset: string;
};

const baseUrl = 'https://unheard.io';
const apply = process.argv.includes('--apply');
const verifyOnly = process.argv.includes('--verify');

async function section(path: string, heading: string): Promise<string> {
  const text = await Bun.file(path).text();
  const marker = `${heading}\n`;
  const start = text.indexOf(marker);
  if (start < 0) throw new Error(`Missing heading ${heading} in ${path}`);
  const contentStart = start + marker.length;
  const rest = text.slice(contentStart);
  const nextHeading = rest.search(/^#{1,6} /m);
  return (nextHeading < 0 ? rest : rest.slice(0, nextHeading))
    .replace(/\n\nCharacter count:.*$/s, '')
    .trim();
}

function at(date: string, time: string): number {
  const value = Date.parse(`${date}T${time}:00+05:30`);
  if (!Number.isFinite(value)) throw new Error(`Invalid schedule: ${date} ${time}`);
  return value;
}

const founderFeedbackLinkedIn = `The State of Customer Feedback After AI Agents

AI has made customer feedback easier to understand but it has not made customer problems proportionally faster to solve.

A modern AI agent can read thousands of support conversations, group similar requests, add account context, and produce a polished summary before a product manager opens their inbox. Investment is following that promise. Enterpret raised a $20.8 million Series A around AI-powered customer intelligence, while products such as Linear and Dovetail are expanding into adjacent parts of the feedback workflow.

The economics are improving too. Stanford’s 2025 AI Index found that the cost of running a system performing at GPT-3.5 level fell more than 280-fold between November 2022 and October 2024.

The cost of finding patterns is collapsing. But the bottleneck has moved.

In the customer workflows we have studied, teams are identifying patterns much faster than they were a year ago. Yet the time between identifying a problem and resolving it has not improved at the same rate.

A customer reports an issue. AI finds similar conversations and creates a summary. A product manager turns it into a work item, engineering ships a change, and the task is marked complete.

During that process, the original customer context often disappears.

Support may not know the change has shipped. The help documentation may still describe the old experience. The customer who raised the issue may never receive an update.

AI improves analysis, but analysis is only the first part of the feedback loop.

The larger opportunity is what happens after the insight: preserving the connection between the original evidence, the product decision, the shipped change, the documentation, and the customers affected by it.

A useful feedback agent should know which conversations created the pattern, which accounts were affected, what decision was made, what changed, whether customer-facing knowledge needs to be updated, and who should be notified.

This also changes the metric that matters.

The value of an AI feedback system should not be measured only by how many conversations it can summarize or themes it can generate. It should be measured by whether the time from customer signal to verified change is falling.

Analysis is becoming cheap.

The next advantage will come from making resolution cheap as well.`;

const founderFeedbackTwitter = `The State of Customer Feedback After AI Agents

AI has made customer feedback easier to understand. It has not made customer problems proportionally faster to solve.`;

const founderFeedbackTwitterThread = [
  `A modern AI agent can read thousands of support conversations, group similar requests, add account context, and produce a polished summary before a PM opens their inbox. Investment is following: Enterpret raised $20.8M, while Linear and Dovetail are expanding nearby.`,
  `The economics are improving too. Stanford’s 2025 AI Index found that the cost of running a system at GPT-3.5 level fell more than 280-fold between November 2022 and October 2024.

The cost of finding patterns is collapsing. But the bottleneck has moved.`,
  `In the customer workflows we have studied, teams identify patterns much faster than a year ago. Yet the time between identifying a problem and resolving it has not improved at the same rate.

Analysis is faster. Resolution is not keeping pace.`,
  `A customer reports an issue. AI finds similar conversations and creates a summary. A product manager turns it into a work item. Engineering ships a change, and the task is marked complete.

During that process, the original customer context often disappears.`,
  `Support may not know the change shipped. Help documentation may still describe the old experience. The customer who raised the issue may never receive an update.

AI improves analysis, but analysis is only the first part of the feedback loop.`,
  `The larger opportunity begins after the insight: preserve the connection between the original evidence, the product decision, the shipped change, the documentation, and the customers affected by it. A useful feedback agent should carry that context through the entire loop.`,
  `A useful feedback agent should know which conversations created the pattern, which accounts were affected, what decision was made, what changed, whether customer-facing knowledge needs an update, and who should be notified.`,
  `That changes the metric. Don’t measure an AI feedback system by conversations summarized or themes generated. Measure whether time from customer signal to verified change is falling.

Analysis is becoming cheap. The next advantage will come from making resolution cheap as well.`,
];

const companyFeedbackLinkedIn = `AI has made feedback processing dramatically cheaper. It has not removed the coordination required after a pattern is found.

A useful feedback system preserves the link between customer evidence and the decision, then follows that decision through delivery.

The shipped change should remain connected to the request. Help content should reflect the new experience, while affected customers receive an update.

Products are moving in this direction. Linear connects customer requests to issues. Dovetail now has agents that can act across connected tools.

The remaining opportunity is a measurable feedback-to-resolution loop, rather than another report for planning.

Userorbit is being built to keep feedback and roadmap decisions connected to releases, then carry the outcome into documentation and customer communication.`;

const companyFeedbackTwitter = `AI can summarize customer feedback faster than teams can act on it. The missing layer comes after the insight: keep evidence attached to the decision and shipped change, then update the help content and affected customers. Better analysis helps. Follow-through changes the system.`;

const packages = [
  ['founder_0718', 'artifacts/social-posts/founder_0718/editorial-package.md', '## Final LinkedIn copy', '## Final X cutdown'],
  ['company_0718', 'artifacts/social-posts/company_0718/editorial-package.md', '## Final LinkedIn copy', '## Final X cutdown'],
  ['founder_0719', 'artifacts/social-posts/founder_0719/copy-and-audit.md', '## LinkedIn', '## X cutdown'],
  ['company_0719', 'artifacts/social-posts/company_0719/final-copy.md', '## LinkedIn', '## X'],
  ['founder_0720', 'artifacts/social-posts/founder_0720/final-copy.md', '## LinkedIn', '## X cutdown'],
  ['company_0720', 'artifacts/social-posts/company_0720/editorial-package.md', '## Final LinkedIn copy', '## Final X cutdown'],
  ['founder_0721', 'artifacts/social-posts/founder_0721/copy.md', '## LinkedIn', '## X'],
  ['company_0721', 'artifacts/social-posts/company_0721/editorial-package.md', '## LinkedIn', '## X'],
  ['founder_0722', 'artifacts/social-posts/founder_0722/copy.md', '## LinkedIn', '## X'],
  ['company_0722', 'artifacts/social-posts/company_0722/copy.md', '# Final LinkedIn copy', '# X cutdown'],
  ['founder_0723', 'artifacts/social-posts/founder_0723/EDITORIAL.md', '## LinkedIn', '## X cutdown'],
  ['company_0723', 'artifacts/social-posts/company_0723/editorial-package.md', '## Final LinkedIn copy', '## Final X cutdown'],
] as const;

const copy = new Map<string, { linkedin: string; twitter: string }>();
for (const [key, path, linkedinHeading, twitterHeading] of packages) {
  copy.set(key, {
    linkedin: await section(path, linkedinHeading),
    twitter: await section(path, twitterHeading),
  });
}

function packageCopy(key: string) {
  const value = copy.get(key);
  if (!value) throw new Error(`Missing copy package ${key}`);
  return value;
}

const entries: Entry[] = [
  {
    key: 'feedback_founder',
    id: '15662c33-66c1-48b0-b677-3bc9d8d41c09',
    group: 'personal',
    publishAt: at('2026-07-19', '15:17'),
    linkedin: founderFeedbackLinkedIn,
    twitter: founderFeedbackTwitter,
    twitterThread: founderFeedbackTwitterThread,
    asset: 'artifacts/xiaohei-feedback-loop/xiaohei-feedback-processing-loop.mp4',
  },
  {
    key: 'feedback_company',
    id: '9b49b572-cae9-4c15-a0cf-9d882d91ad0e',
    group: 'company',
    publishAt: at('2026-07-19', '16:43'),
    linkedin: companyFeedbackLinkedIn,
    twitter: companyFeedbackTwitter,
    asset: 'artifacts/xiaohei-feedback-loop/xiaohei-feedback-processing-poster.png',
  },
  { key: 'founder_0718', id: '0af61859-ef56-4981-a99c-6cfa9ea8caa0', group: 'personal', publishAt: at('2026-07-20', '08:23'), ...packageCopy('founder_0718'), asset: 'artifacts/social-posts/founder_0718/release-communication-audience-check.png' },
  { key: 'company_0718', id: 'b344c4c0-c84c-46d9-ae0d-3b2c2a78bb6c', group: 'company', publishAt: at('2026-07-20', '15:47'), ...packageCopy('company_0718'), asset: 'artifacts/social-posts/company_0718/production-visibility-state-ladder.png' },
  { key: 'founder_0719', id: 'd40b80fe-74c5-471b-84cf-0f90e916b09c', group: 'personal', publishAt: at('2026-07-21', '08:41'), ...packageCopy('founder_0719'), asset: 'artifacts/social-posts/founder_0719/founder-agent-authority.png' },
  { key: 'company_0719', id: 'fcab51e6-1207-4400-8d9f-dd722d2abae2', group: 'company', publishAt: at('2026-07-21', '16:08'), ...packageCopy('company_0719'), asset: 'artifacts/social-posts/company_0719/agent-runtime-checkpoints.png' },
  { key: 'founder_0720', id: 'ccd1255d-0304-4f14-a913-c7a4b3aa8695', group: 'personal', publishAt: at('2026-07-22', '08:12'), ...packageCopy('founder_0720'), asset: 'artifacts/social-posts/founder_0720/deflection-vs-recurrence-1200x1500.png' },
  { key: 'company_0720', id: '8c2bfc31-7918-47db-9704-92f058e5ecaf', group: 'company', publishAt: at('2026-07-22', '15:36'), ...packageCopy('company_0720'), asset: 'artifacts/social-posts/company_0720/ai-support-outcome-verification-gate.png' },
  { key: 'founder_0721', id: 'ecdeebfe-c218-44a5-9e4b-e1d4ef598dff', group: 'personal', publishAt: at('2026-07-23', '08:54'), ...packageCopy('founder_0721'), asset: 'artifacts/social-posts/founder_0721/pm-agent-work-design-card.png' },
  { key: 'company_0721', id: '2f546924-3a68-47bc-8cf8-cf51df7cec3c', group: 'company', publishAt: at('2026-07-23', '16:22'), ...packageCopy('company_0721'), asset: 'artifacts/social-posts/company_0721/governed-product-ops-still.png' },
  { key: 'founder_0722', id: '17b23dc0-dac7-4296-8bc8-8e7c796659c6', group: 'personal', publishAt: at('2026-07-24', '08:31'), ...packageCopy('founder_0722'), asset: 'artifacts/social-posts/founder_0722/urgent-request-triage.png' },
  { key: 'company_0722', id: 'e8bcf923-f4f2-4d97-9b99-eb3bb9668cad', group: 'company', publishAt: at('2026-07-24', '15:58'), ...packageCopy('company_0722'), asset: 'artifacts/social-posts/company_0722/feedback-board-evidence-layer.png' },
  { key: 'founder_0723', id: '38ac3ff0-f505-4b8c-aedb-0ec30b9e26b5', group: 'personal', publishAt: at('2026-07-28', '08:37'), ...packageCopy('founder_0723'), asset: 'artifacts/social-posts/founder_0723/ai-implementation-cost-shift-1200x630.png' },
  { key: 'company_0723', id: '793fef98-9917-42d1-8da5-d531030c0894', group: 'company', publishAt: at('2026-07-25', '16:27'), ...packageCopy('company_0723'), asset: 'artifacts/social-posts/company_0723/customer-learning-latency-still.png' },
];

for (const entry of entries) {
  if (!(await Bun.file(entry.asset).exists())) throw new Error(`Missing asset ${entry.asset}`);
  const tweets = [entry.twitter, ...(entry.twitterThread ?? [])];
  for (const [index, tweet] of tweets.entries()) {
    const xLength = [...tweet].length;
    if (xLength > 280) throw new Error(`${entry.key} X tweet ${index + 1} is ${xLength} characters`);
  }
  if (entry.publishAt <= Date.now()) throw new Error(`${entry.key} schedule is not in the future`);
}

if (!apply && !verifyOnly) {
  console.table(entries.map(entry => ({
    key: entry.key,
    group: entry.group,
    publishAt: new Date(entry.publishAt).toISOString(),
    xLength: [...entry.twitter].length,
    threadLength: entry.twitterThread?.length ?? 0,
    asset: entry.asset.split('/').at(-1),
  })));
  process.exit(0);
}

const apiKey = process.env.API_SECRET_KEY;
if (!apiKey) throw new Error('API_SECRET_KEY is required');

async function api(path: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...init.headers,
    },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${path} failed (${response.status}): ${JSON.stringify(body)}`);
  return body;
}

for (const entry of entries) {
  const existing = await api(`/api/posts?id=${entry.id}`);
  if (existing.channel_group !== entry.group) {
    throw new Error(`${entry.key} expected ${entry.group}, found ${existing.channel_group}`);
  }
  const platforms = existing.targets.map((target: { platform: string }) => target.platform).sort();
  if (platforms.join(',') !== 'linkedin,twitter') {
    throw new Error(`${entry.key} has unexpected platforms: ${platforms.join(', ')}`);
  }

  if (verifyOnly) {
    if (existing.state !== 'scheduled' || existing.publish_at !== entry.publishAt) {
      throw new Error(`${entry.key} schedule verification failed`);
    }
    if (existing.media.length !== 1) throw new Error(`${entry.key} expected one media item`);
    const expectedType = entry.asset.endsWith('.mp4') ? 'video' : 'image';
    if (existing.media[0].type !== expectedType) throw new Error(`${entry.key} media type verification failed`);
    for (const target of existing.targets) {
      const expectedContent = target.platform === 'linkedin' ? entry.linkedin : entry.twitter;
      if (target.content !== expectedContent) throw new Error(`${entry.key} ${target.platform} copy verification failed`);
      const expectedThread = target.platform === 'twitter' ? entry.twitterThread ?? [] : [];
      if (JSON.stringify(target.thread ?? []) !== JSON.stringify(expectedThread)) {
        throw new Error(`${entry.key} ${target.platform} thread verification failed`);
      }
      if (!target.channel_id) throw new Error(`${entry.key} ${target.platform} channel is missing`);
    }
    console.log(JSON.stringify({
      key: entry.key,
      state: existing.state,
      group: existing.channel_group,
      publishAt: new Date(existing.publish_at).toISOString(),
      mediaType: existing.media[0].type,
      platforms,
    }));
    continue;
  }

  const form = new FormData();
  form.set('file', Bun.file(entry.asset), entry.asset.split('/').at(-1));
  const uploaded = await api('/api/upload', { method: 'POST', body: form });

  const originalChannels = new Map(existing.targets.map((target: { platform: string; channel_id: string | null }) => [target.platform, target.channel_id]));
  const targets = existing.targets.map((target: Record<string, unknown>) => ({
    platform: target.platform,
    channel_id: target.channel_id ?? null,
    content: target.platform === 'linkedin' ? entry.linkedin : entry.twitter,
    reply_settings: target.reply_settings ?? 'everyone',
    as_carousel: target.as_carousel ?? false,
    carousel_name: target.carousel_name ?? null,
    thread: target.platform === 'twitter' ? entry.twitterThread ?? [] : [],
  }));

  const updated = await api('/api/posts', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: entry.id,
      targets,
      media: [uploaded],
      publish_at: entry.publishAt,
      state: 'scheduled',
      channel_group: existing.channel_group,
      template_id: existing.template_id ?? null,
      writing_prompt: existing.writing_prompt ?? null,
      idea_id: existing.idea_id ?? null,
      brand_id: existing.brand_id ?? null,
    }),
  });

  if (updated.state !== 'scheduled' || updated.publish_at !== entry.publishAt) {
    throw new Error(`${entry.key} did not retain the requested schedule`);
  }
  if (updated.media.length !== 1 || updated.media[0].id !== uploaded.id) {
    throw new Error(`${entry.key} did not replace media with the uploaded asset`);
  }
  for (const target of updated.targets) {
    const expectedContent = target.platform === 'linkedin' ? entry.linkedin : entry.twitter;
    if (target.content !== expectedContent) throw new Error(`${entry.key} ${target.platform} copy mismatch`);
    const expectedThread = target.platform === 'twitter' ? entry.twitterThread ?? [] : [];
    if (JSON.stringify(target.thread ?? []) !== JSON.stringify(expectedThread)) {
      throw new Error(`${entry.key} ${target.platform} thread mismatch`);
    }
    if (target.channel_id !== originalChannels.get(target.platform)) throw new Error(`${entry.key} ${target.platform} channel changed`);
  }

  console.log(JSON.stringify({
    key: entry.key,
    id: entry.id,
    group: entry.group,
    publishAt: new Date(entry.publishAt).toISOString(),
    mediaType: uploaded.type,
    linkedinOpening: entry.linkedin.split('\n')[0],
    xLength: [...entry.twitter].length,
    threadLength: entry.twitterThread?.length ?? 0,
  }));
}
