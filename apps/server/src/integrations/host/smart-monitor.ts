import { PollScheduler } from '../../core/scheduler.js';
import { SnapshotReadError } from './snapshot-reader.js';
import { readSmartSnapshot } from './smart-reader.js';
import type { SmartStateStore } from './smart-state.js';

export class SmartMonitor {
  private readonly scheduler: PollScheduler;
  constructor(path: string, state: SmartStateStore, now: () => number = Date.now) {
    this.scheduler = new PollScheduler((signal) => {
      if (signal.aborted) return Promise.resolve(false);
      try { state.ingest(readSmartSnapshot(path, now()), now()); return Promise.resolve(true); }
      catch (error) { state.failure(error instanceof SnapshotReadError ? error.code : 'internal', now()); return Promise.resolve(false); }
    }, { intervalMs: 30_000 });
  }
  start() { this.scheduler.start(); }
  stop() { return this.scheduler.stop(); }
}
