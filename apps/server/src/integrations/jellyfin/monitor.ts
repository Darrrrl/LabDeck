import { PollScheduler } from '../../core/scheduler.js';
import type { JellyfinAdapter } from './adapter.js';
import type { JellyfinStateStore } from './state.js';

export class JellyfinMonitor {
  private readonly schedulers: PollScheduler[];
  constructor(adapter: JellyfinAdapter, state: JellyfinStateStore, now: () => number = Date.now) {
    this.schedulers = [
      schedule('connection', 30_000, (signal) => adapter.connection(signal), state, now),
      schedule('playback', 10_000, (signal) => adapter.playback(signal), state, now),
      schedule('library', 300_000, (signal) => adapter.library(signal), state, now)
    ];
  }
  start(): void { for (const scheduler of this.schedulers) scheduler.start(); }
  async stop(): Promise<void> { await Promise.all(this.schedulers.map((scheduler) => scheduler.stop())); }
}
function schedule(group: 'connection' | 'playback' | 'library', intervalMs: number, poll: (signal: AbortSignal) => Promise<Parameters<JellyfinStateStore['success']>[1]>, state: JellyfinStateStore, now: () => number): PollScheduler {
  return new PollScheduler(async (signal) => { try { state.success(group, await poll(signal), now()); return true; } catch (error) { state.failure(group, error, now()); return false; } }, { intervalMs });
}
