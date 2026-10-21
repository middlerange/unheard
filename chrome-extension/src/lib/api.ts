// ABOUTME: API client for the Content Hub backend — handles AI generation requests.
// ABOUTME: Uses cookie bridge — sends requests with credentials so the server reads the session cookie.

const DEFAULT_BASE_URL = 'https://content-hub.codejets.workers.dev';

interface GenerateParams {
  prompt: string;
  platform?: string;
  tone?: string;
  model?: string;
  existingContent?: string;
  pageContext?: string;
}

export async function generateContent(params: GenerateParams): Promise<ReadableStream<Uint8Array>> {
  const body: Record<string, string> = {
    prompt: params.prompt,
    platform: params.platform ?? 'linkedin',
    tone: params.tone ?? 'engaging',
    model: params.model ?? 'gpt-5',
  };

  if (params.existingContent) body.existingContent = params.existingContent;
  if (params.pageContext) body.prompt = `Context from the current page:\n${params.pageContext}\n\nRequest: ${params.prompt}`;

  const response = await fetch(`${DEFAULT_BASE_URL}/api/ai`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    if (response.status === 401) {
      throw new Error('Not logged in. Sign in at content-hub.codejets.workers.dev first.');
    }
    throw new Error(`API error: ${response.status} — ${err}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  return new ReadableStream({
    async start(controller) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          break;
        }
        controller.enqueue(value);
      }
    },
  });
}

export async function getCurrentTabContext(): Promise<{
  url: string;
  title: string;
  description: string;
  selectedText: string;
  mainContent: string;
} | null> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id) return null;

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_CONTEXT' });
    return response;
  } catch {
    return {
      url: tab.url ?? '',
      title: tab.title ?? '',
      description: '',
      selectedText: '',
      mainContent: '',
    };
  }
}
