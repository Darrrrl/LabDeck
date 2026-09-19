import { afterEach, describe, expect, it, vi } from 'vitest';
import { PollScheduler } from './scheduler.js';

describe('PollScheduler', () => {
  afterEach(() => vi.useRealTimers());

  it('never overlaps polls and applies bounded exponential backoff', async () => {
    vi.useFakeTimers();
    let active = 0;
    let maximumActive = 0;
    let calls = 0;
    const scheduler = new PollScheduler(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 100));
      active -= 1;
      return calls >= 3;
    }, { intervalMs: 1_000, maximumBackoffMs: 4_000, jitterRatio: 0, random: () => 0.5 });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(100); // first failure, next after 2s
    await vi.advanceTimersByTimeAsync(2_100); // second failure, next after 4s
    await vi.advanceTimersByTimeAsync(4_100); // success, next after 1s
    await vi.advanceTimersByTimeAsync(1_100);
    expect(calls).toBe(4);
    expect(maximumActive).toBe(1);
    await scheduler.stop();
  });

  it('aborts and drains an active poll on stop', async () => {
    vi.useFakeTimers();
    let aborted = false;
    const scheduler = new PollScheduler((signal) => new Promise((resolve) => {
      signal.addEventListener('abort', () => { aborted = true; resolve(false); });
    }), { intervalMs: 1_000 });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    await scheduler.stop();
    expect(aborted).toBe(true);
  });
});
