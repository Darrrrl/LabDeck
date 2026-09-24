import { PollScheduler } from '../../core/scheduler.js';
import type { ProwlarrAdapter } from './adapter.js';
import type { ProwlarrStateStore } from './state.js';

export class ProwlarrMonitor {
  private readonly schedulers: PollScheduler[];
  constructor(adapter: ProwlarrAdapter, state: ProwlarrStateStore, now: () => number = Date.now) {
    this.schedulers = [
      new PollScheduler(async (signal) => { try { state.success('connection', await adapter.connection(signal), now()); return true; } catch (error) { state.failure('connection', error, now()); return false; } }, { intervalMs: 60_000 }),
      new PollScheduler(async (signal) => { try { state.success('health', await adapter.health(signal), now()); return true; } catch (error) { state.failure('health', error, now()); return false; } }, { intervalMs: 60_000 })
    ];
  }
  start() { for (const item of this.schedulers) item.start(); }
  async stop() { await Promise.all(this.schedulers.map((item) => item.stop())); }
}
