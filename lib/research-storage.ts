function isLostConnection(error: unknown) {
  const seen = new Set<unknown>();
  for (let depth = 0; error && depth < 8 && !seen.has(error); depth++) {
    seen.add(error);
    const message = typeof error === 'string' ? error : typeof error === 'object' && 'message' in error ? error.message : undefined;
    if (typeof message === 'string' && /^(?:D1_ERROR:\s*)?Network connection lost\.?$/i.test(message.trim())) return true;
    error = typeof error === 'object' && 'cause' in error ? error.cause : undefined;
  }
  return false;
}

// Only use for idempotent storage writes, never model calls or increment-only updates.
export async function retryResearchStorage<T>(write: () => Promise<T>): Promise<T> {
  const delays = [250, 1000];
  for (let attempt = 0; ; attempt++) {
    try {
      return await write();
    } catch (error) {
      if (!isLostConnection(error) || attempt === delays.length) throw error;
      await new Promise(resolve => setTimeout(resolve, delays[attempt]));
    }
  }
}
