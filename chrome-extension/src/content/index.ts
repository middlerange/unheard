// ABOUTME: Content script — extracts page context and forwards to side panel.
// ABOUTME: Listens for requests from the side panel and returns page metadata, selected text, and main content.

interface PageContext {
  url: string;
  title: string;
  description: string;
  selectedText: string;
  mainContent: string;
}

function extractMainContent(): string {
  const article = document.querySelector('article');
  if (article) return article.textContent?.trim().slice(0, 3000) ?? '';

  const main = document.querySelector('main');
  if (main) return main.textContent?.trim().slice(0, 3000) ?? '';

  const body = document.body.textContent?.trim() ?? '';
  return body.slice(0, 2000);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_PAGE_CONTEXT') {
    const ctx: PageContext = {
      url: window.location.href,
      title: document.title,
      description: document.querySelector('meta[name="description"]')?.getAttribute('content') ?? '',
      selectedText: window.getSelection()?.toString().trim() ?? '',
      mainContent: extractMainContent(),
    };
    sendResponse(ctx);
  }
  return true;
});
