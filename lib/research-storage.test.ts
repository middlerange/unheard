import { afterEach, describe, expect, it, vi } from 'vitest';
import { retryResearchStorage } from './research-storage';

afterEach(() => vi.useRealTimers());

describe('idempotent research storage retries', () => {
  it('waits 250ms then 1000ms for an exact lost connection in the cause chain', async () => {
    vi.useFakeTimers();
    const error = new Error('Failed query: private SQL', { cause: new Error('D1_ERROR: Network connection lost.') });
    const write = vi.fn().mockRejectedValueOnce(error).mockRejectedValueOnce(error).mockResolvedValue('saved');
    const result = retryResearchStorage(write);
    await vi.advanceTimersByTimeAsync(249);
    expect(write).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(write).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(999);
    expect(write).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe('saved');
    expect(write).toHaveBeenCalledTimes(3);
  });

  it.each([
    'UNIQUE constraint failed',
    'D1_ERROR: Too many requests',
    'Failed query: INSERT private text Network connection lost.',
    'Network connection lost. Retrying might help.',
  ])('does not retry a permanent or unrelated failure: %s', async message => {
    const error = new Error(message);
    const write = vi.fn().mockRejectedValue(error);
    await expect(retryResearchStorage(write)).rejects.toBe(error);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('exposes the final lost connection after three attempts, including cyclic causes', async () => {
    vi.useFakeTimers();
    const error = new Error('Network connection lost.');
    Object.assign(error, { cause: error });
    const write = vi.fn().mockRejectedValue(error);
    const result = retryResearchStorage(write);
    const rejection = expect(result).rejects.toBe(error);
    await vi.runAllTimersAsync();
    await rejection;
    expect(write).toHaveBeenCalledTimes(3);
  });
});
