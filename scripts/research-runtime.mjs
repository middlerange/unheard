// Shared by the generated Worker and its durable research workflow.

export function bindResearchEnvironment(env) {
  globalThis.__contentHubDb__ = env.DB;
  globalThis.__contentHubMediaBucket__ = env.MEDIA_BUCKET;
  globalThis.__contentHubResearchWorkflow__ = env.RESEARCH_WORKFLOW;
  globalThis.__contentHubSlackWorkflow__ = env.SLACK_WORKFLOW;
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') process.env[key] = value;
  }
}

export async function invokeResearchProcess(handler, env, payload, path = '/api/research/process') {
  if (!env.SESSION_SECRET) throw new Error('Research requires SESSION_SECRET.');
  bindResearchEnvironment(env);
  const body = JSON.stringify(payload);
  const timestamp = String(Date.now());
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const signatureBytes = await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${body}`));
  const signature = Array.from(new Uint8Array(signatureBytes), byte => byte.toString(16).padStart(2, '0')).join('');
  const request = new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-research-timestamp': timestamp,
      'x-research-signature': signature,
    },
    body,
  });
  const response = await handler.fetch(request, env);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Research step failed (${response.status}).`);
  return result;
}

export async function runResearchWorkflow(runId, step, invoke) {
  const collectionOptions = { retries: { limit: 2, delay: '5 seconds', backoff: 'exponential' }, timeout: '3 minutes' };
  try {
    const plan = await step.do('Plan research collection', collectionOptions, () => invoke({ operation: 'plan', runId }));
    for (const sourceId of plan.sourceIds) {
      await step.do(`Collect ${sourceId}`, collectionOptions, () => invoke({ operation: 'collect', runId, sourceId }));
    }
    // A model request can be billed even if its response is interrupted. Resume via
    // persisted analysis records rather than automatically repeating a paid step.
    const paidOptions = { retries: { limit: 0, delay: '1 second', backoff: 'constant' }, timeout: '10 minutes' };
    let batch = 1;
    let ranking = await step.do('Rank findings', paidOptions, () => invoke({ operation: 'rank', runId }));
    while (ranking?.pending === true) {
      batch++;
      ranking = await step.do(`Rank findings batch ${batch}`, paidOptions, () => invoke({ operation: 'rank', runId }));
    }
    return await step.do('Draft daily posts', paidOptions, () => invoke({ operation: 'drafts', runId }));
  } catch (error) {
    await step.do('Record research failure', collectionOptions, () => invoke({
      operation: 'fail', runId, error: error instanceof Error ? error.message : 'Research failed.',
    }));
    throw error;
  }
}

export async function runSlackWorkflow(jobId, step, invoke) {
  // Publishing and model work may succeed remotely before a response is lost.
  // Persisted jobs and per-target platform IDs are the retry boundary.
  return step.do('Process Slack review', {
    retries: { limit: 0, delay: '1 second', backoff: 'constant' }, timeout: '10 minutes',
  }, () => invoke({ operation: 'process', jobId }));
}

export function researchDailyJob(scheduledTime) {
  return { operation: 'daily', scheduledTime };
}
