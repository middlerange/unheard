// ABOUTME: Regression coverage for editor HTML and preview/publisher plain-text conversion.
// ABOUTME: Ensures paragraph breaks and manual line breaks survive the shared text pipeline.

import { describe, expect, it } from 'vitest';
import { htmlToText, normalizeEditorContent } from './text';

describe('editor text normalization', () => {
  it('converts blank-line-separated text into distinct paragraphs', () => {
    expect(normalizeEditorContent('Title\n\nBody')).toBe('<p>Title</p><p>Body</p>');
  });

  it('keeps a single newline as a line break within one paragraph', () => {
    expect(normalizeEditorContent('First line\nSecond line')).toBe('<p>First line<br>Second line</p>');
  });

  it('preserves single and double newline semantics through the preview pipeline', () => {
    const source = 'Title\n\nFirst line\nSecond line';

    expect(htmlToText(normalizeEditorContent(source))).toBe(source);
  });
});
