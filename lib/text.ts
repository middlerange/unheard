// ABOUTME: Shared text utility for converting HTML to plain text.
// ABOUTME: Used by preview components and the publisher to strip TipTap HTML.

const HTML_TAG_RE = /<\/?[a-z][\w:-]*(?:\s[^<>]*)?>/i;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function isHtmlContent(content: string): boolean {
  return HTML_TAG_RE.test(content);
}

export function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map(p => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/** Convert common markdown inline syntax to HTML spans/nodes. */
function markdownToHtml(text: string): string {
  // Split into paragraphs (double newline), convert each
  const paragraphs = text.split(/\n{2,}/);
  return paragraphs
    .map(paragraph => {
      // Process line by line within the paragraph
      const lines = paragraph.split('\n');
      const processedLines = lines.map(line => {
        let html = escapeHtml(line);
        // Bold+italic: ***text*** or ___text___
        html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
        html = html.replace(/___(.+?)___/g, '<strong><em>$1</em></strong>');
        // Bold: **text** or __text__
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
        // Italic: *text* or _text_
        html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
        html = html.replace(/_(.+?)_/g, '<em>$1</em>');
        // Strikethrough: ~~text~~
        html = html.replace(/~~(.+?)~~/g, '<s>$1</s>');
        // Inline code: `text`
        html = html.replace(/`(.+?)`/g, '<code>$1</code>');
        // Links: [text](url)
        html = html.replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" rel="noopener noreferrer">$1</a>');
        return html;
      });
      return `<p>${processedLines.join('<br>')}</p>`;
    })
    .join('');
}

/** Returns true if the text contains any markdown formatting syntax. */
function hasMarkdownSyntax(text: string): boolean {
  return /\*\*|__|\*[^*]|_[^_]|~~|\[.+\]\(https?:/.test(text);
}

export function normalizeEditorContent(content: string): string {
  if (!content.trim()) return '';
  if (isHtmlContent(content)) return content;
  // If the plain text contains markdown syntax, parse it properly
  if (hasMarkdownSyntax(content)) return markdownToHtml(content);
  return textToHtml(content);
}

export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{4,}/g, '\n\n')
    .trim();
}

function splitByWords(text: string, maxLen: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const chunks: string[] = [];
  let current = '';

  const pushCurrent = () => {
    if (!current) return;
    chunks.push(current);
    current = '';
  };

  for (const word of words) {
    if (word.length > maxLen) {
      pushCurrent();
      let idx = 0;
      while (idx < word.length) {
        chunks.push(word.slice(idx, idx + maxLen));
        idx += maxLen;
      }
      continue;
    }

    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxLen) {
      current = candidate;
    } else {
      pushCurrent();
      current = word;
    }
  }

  pushCurrent();
  return chunks;
}

function splitParagraphBySentences(paragraph: string, maxLen: number): string[] {
  const sentences = paragraph.match(/[^.!?]+(?:[.!?]+|$)/g)?.map(s => s.trim()).filter(Boolean) ?? [];
  if (sentences.length === 0) return splitByWords(paragraph, maxLen);

  const chunks: string[] = [];
  let current = '';

  const pushCurrent = () => {
    if (!current) return;
    chunks.push(current);
    current = '';
  };

  for (const sentence of sentences) {
    if (sentence.length > maxLen) {
      pushCurrent();
      chunks.push(...splitByWords(sentence, maxLen));
      continue;
    }

    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length <= maxLen) {
      current = candidate;
    } else {
      pushCurrent();
      current = sentence;
    }
  }

  pushCurrent();
  return chunks;
}

export function splitIntoTweetChunks(text: string, maxLen = 280): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map(part => part.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = '';

  const pushCurrent = () => {
    if (!current) return;
    chunks.push(current);
    current = '';
  };

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length <= maxLen) {
      current = candidate;
      continue;
    }

    pushCurrent();

    if (paragraph.length <= maxLen) {
      current = paragraph;
      continue;
    }

    const sentenceChunks = splitParagraphBySentences(paragraph, maxLen);
    for (const sentenceChunk of sentenceChunks) {
      if (sentenceChunk.length <= maxLen) {
        chunks.push(sentenceChunk);
      } else {
        chunks.push(...splitByWords(sentenceChunk, maxLen));
      }
    }
  }

  pushCurrent();
  return chunks;
}
