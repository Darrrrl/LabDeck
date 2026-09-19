import { PollScheduler } from '../../core/scheduler.js';
import type { HostStateService } from '../../core/state.js';
import { readHostSnapshot, SnapshotReadError } from './snapshot-reader.js';

export class HostMonitor {
  readonly #scheduler: PollScheduler;

  constructor(path: string, state: HostStateService, now: () => number = Date.now) {
    this.#scheduler = new PollScheduler((signal) => {
      if (signal.aborted) return Promise.resolve(false);
      try {
        const snapshot = readHostSnapshot(path, now());
        state.ingest(snapshot, now());
        return Promise.resolve(true);
      } catch (error) {
        state.fail(error instanceof SnapshotReadError ? error.code : 'internal', now());
        return Promise.resolve(false);
      }
    }, { intervalMs: 5_000, maximumBackoffMs: 300_000 });
  }

  start(): void { this.#scheduler.start(); }
  stop(): Promise<void> { return this.#scheduler.stop(); }
}
