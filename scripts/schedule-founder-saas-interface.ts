const baseUrl = 'https://unheard.io';
const apply = process.argv.includes('--apply');
const bannerPath = 'artifacts/social-posts/founder_0724/banner-slack.png';
const publishAt = Date.parse('2026-07-25T08:46:00+05:30');

const linkedinChannelId = '3c13d92a-2a41-4f5c-8915-fbf96030d118';
const twitterChannelId = '9ea8e089-dcfd-4f4a-aeaf-351ccd7f1b58';

const linkedin = `Why might the next generation of SaaS be the one you rarely have to open?

One of the most common measures of a product’s success is how often people use it, day after day. That seems to be changing with the new interfaces people are building around AI and LLMs.

Until now, the norm looked something like this: a request appears in Slack or email. You open another tab, find the right record and rebuild enough context to act. Then you switch to another app to take that action before returning to update the original record.

Teams built integrations and workflows to bridge these gaps.

Andrej Karpathy called Claude Tag the “third major redesign of LLM UIUX”: from a website, to an app, to a persistent teammate inside the tools and context of an organization.

Our read is that the interesting shift is larger than agents and larger than Slack. Software is moving closer to the moment where work begins.

Spotify’s Honk can be mentioned halfway through a Slack conversation and return with a pull request. The separate dashboard still exists, but it is used to see which runs are active and where attention is needed.

Everyone has seen the adoption of agent orchestrators such as Hermes and OpenClaw.

All of this feels like an emerging division of labor. The dashboard remains useful for configuration, deeper investigation and oversight. Frequent actions happen closer to the conversation that created them.

We have reached a similar conclusion while rebuilding Userorbit’s support flow.

A customer message in Slack can become a support thread. A teammate can reply from an internal Slack alert or turn the surrounding conversation into feedback without copying it into another tool. Userorbit checks for duplicates and keeps the source attached.

P.S. I do not think every SaaS product should become a Slack bot. I do think every product should question whether opening its dashboard is necessary for the next action.

My bet is that users will value software less by how much time they spend inside it and more by how much useful work it completes without making them reconstruct the context.`;

const tweets = [
  `Why might the next generation of SaaS be the one you rarely have to open?`,
  `One of the most common measures of a product’s success is how often people use it, day after day. That may be changing with the new interfaces being built around AI and LLMs.`,
  `Until now, the norm looked like this: a request appears in Slack or email. You open another tab, find the right record and rebuild the context. Then you switch apps to act, before returning to update the original record.

Teams built integrations to bridge these gaps.`,
  `Andrej Karpathy called Claude Tag the “third major redesign of LLM UIUX”: from a website, to an app, to a persistent teammate inside the tools and context of an organization.

Our read: this shift is larger than agents—and larger than Slack.`,
  `Spotify’s Honk can be mentioned halfway through a Slack conversation and return with a pull request. A separate dashboard still exists, but it’s used to see which runs are active and where attention is needed.

We’ve seen a similar pattern with Hermes and OpenClaw.`,
  `This feels like an emerging division of labor.

The dashboard remains useful for configuration, deeper investigation and oversight. Frequent actions happen closer to the conversation that created them.`,
  `We’ve reached a similar conclusion while rebuilding Userorbit’s support flow.

A customer message in Slack can become a support thread. A teammate can reply from an internal alert or turn the surrounding conversation into feedback—without copying it into another tool.`,
  `Not every SaaS product should become a Slack bot. But every product should ask whether opening its dashboard is necessary for the next action.

My bet: users will value software less by time spent inside it, and more by useful work completed without reconstructing context.`,
];

if (!Number.isFinite(publishAt) || publishAt <= Date.now()) {
  throw new Error('The publish time must be in the future');
}
if ([...linkedin].length > 3000) throw new Error('LinkedIn copy exceeds 3,000 characters');
for (const [index, tweet] of tweets.entries()) {
  const length = [...tweet].length;
  if (length > 280) throw new Error(`Tweet ${index + 1} is ${length} characters`);
}
if (!(await Bun.file(bannerPath).exists())) throw new Error(`Missing banner: ${bannerPath}`);

const summary = {
  publishAt: new Date(publishAt).toISOString(),
  linkedinLength: [...linkedin].length,
  tweetLengths: tweets.map(tweet => [...tweet].length),
  bannerPath,
};

if (!apply) {
  console.log(JSON.stringify(summary));
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
  if (!response.ok) {
    throw new Error(`${init.method ?? 'GET'} ${path} failed (${response.status}): ${JSON.stringify(body)}`);
  }
  return body;
}

const current = await api('/api/posts?states=draft,scheduled,awaiting_approval');
let post = current.find((candidate: any) =>
  candidate.channel_group === 'personal' &&
  candidate.targets?.some((target: any) => target.platform === 'linkedin' && target.content === linkedin),
);

if (!post) {
  const form = new FormData();
  form.set('file', Bun.file(bannerPath), 'banner-slack.png');
  const uploaded = await api('/api/upload', { method: 'POST', body: form });

  post = await api('/api/posts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      state: 'scheduled',
      publish_at: publishAt,
      channel_group: 'personal',
      targets: [
        {
          platform: 'linkedin',
          channel_id: linkedinChannelId,
          content: linkedin,
          reply_settings: 'everyone',
          as_carousel: false,
          carousel_name: null,
          thread: [],
        },
        {
          platform: 'twitter',
          channel_id: twitterChannelId,
          content: tweets[0],
          reply_settings: 'everyone',
          as_carousel: false,
          carousel_name: null,
          thread: tweets.slice(1),
        },
      ],
      media: [uploaded],
    }),
  });
}

const saved = await api(`/api/posts?id=${post.id}`);
if (saved.state !== 'scheduled' || saved.publish_at !== publishAt) {
  throw new Error('Schedule verification failed');
}
if (saved.channel_group !== 'personal') throw new Error('Founder channel group verification failed');
if (saved.media?.length !== 1 || saved.media[0].type !== 'image') {
  throw new Error('Media verification failed');
}

const expected = new Map([
  ['linkedin', { channelId: linkedinChannelId, content: linkedin, thread: [] }],
  ['twitter', { channelId: twitterChannelId, content: tweets[0], thread: tweets.slice(1) }],
]);
for (const target of saved.targets ?? []) {
  const value = expected.get(target.platform);
  if (!value) throw new Error(`Unexpected platform: ${target.platform}`);
  if (target.channel_id !== value.channelId) throw new Error(`${target.platform} channel verification failed`);
  if (target.content !== value.content) throw new Error(`${target.platform} copy verification failed`);
  if (JSON.stringify(target.thread ?? []) !== JSON.stringify(value.thread)) {
    throw new Error(`${target.platform} thread verification failed`);
  }
  expected.delete(target.platform);
}
if (expected.size) throw new Error(`Missing platforms: ${[...expected.keys()].join(', ')}`);

console.log(JSON.stringify({
  id: saved.id,
  state: saved.state,
  publishAt: new Date(saved.publish_at).toISOString(),
  channelGroup: saved.channel_group,
  platforms: saved.targets.map((target: any) => ({
    platform: target.platform,
    channelId: target.channel_id,
    channelName: target.channel_name,
    threadLength: target.thread?.length ?? 0,
  })),
  media: saved.media.map((item: any) => ({
    id: item.id,
    filename: item.filename,
    type: item.type,
    targetId: item.target_id ?? null,
  })),
}));
