// ABOUTME: Regression coverage for shared and platform-specific post attachment selection.
// ABOUTME: Keeps editor previews aligned with the media that publishing will use.

import { describe, expect, it } from 'vitest';
import { resolvePostMedia } from './post-media';

describe('resolvePostMedia', () => {
  const shared = [{ id: 'shared' }];

  it('uses shared media when a target has no platform-specific attachments', () => {
    expect(resolvePostMedia(shared, [])).toEqual(shared);
  });

  it('uses platform-specific media instead of shared media when present', () => {
    const targetMedia = [{ id: 'target' }];

    expect(resolvePostMedia(shared, targetMedia)).toEqual(targetMedia);
  });
});
