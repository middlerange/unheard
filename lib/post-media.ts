// ABOUTME: Resolves which post attachments apply to a specific publishing target.
// ABOUTME: Platform-specific media overrides shared media, matching publisher behavior.

export function resolvePostMedia<T>(sharedMedia: T[], targetMedia: T[]): T[] {
  return targetMedia.length > 0 ? targetMedia : sharedMedia;
}
