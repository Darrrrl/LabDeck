export interface SchedulerOptions {
  intervalMs: number;
  maximumBackoffMs?: number;
  jitterRatio?: number;
  random?: () => number;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
}

export class PollScheduler {
  readonly #task: (signal: AbortSignal) => Promise<boolean>;
  readonly #options: Required<SchedulerOptions>;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #controller: AbortController | undefined;
  #running: Promise<void> | undefined;
  #failures = 0;
  #stopped = true;

  constructor(task: (signal: AbortSignal) => Promise<boolean>, options: SchedulerOptions) {
    this.#task = task;
    this.#options = {
      intervalMs: options.intervalMs,
      maximumBackoffMs: options.maximumBackoffMs ?? 300_000,
      jitterRatio: options.jitterRatio ?? 0.1,
      random: options.random ?? Math.random,
      setTimer: options.setTimer ?? setTimeout,
      clearTimer: options.clearTimer ?? clearTimeout
    };
  }

  start(): void {
    if (!this.#stopped) return;
    this.#stopped = false;
    this.#schedule(0);
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    if (this.#timer) this.#options.clearTimer(this.#timer);
    this.#timer = undefined;
    this.#controller?.abort();
    await this.#running;
  }

  #schedule(delay: number): void {
    this.#timer = this.#options.setTimer(() => {
      this.#timer = undefined;
      this.#running = this.#run();
    }, delay);
  }

  async #run(): Promise<void> {
    this.#controller = new AbortController();
    let successful: boolean;
    try {
      successful = await this.#task(this.#controller.signal);
    } catch {
      successful = false;
    }
    if (this.#stopped) return;
    this.#failures = successful ? 0 : this.#failures + 1;
    const multiplier = successful ? 1 : Math.min(2 ** this.#failures, this.#options.maximumBackoffMs / this.#options.intervalMs);
    const base = Math.min(this.#options.intervalMs * multiplier, this.#options.maximumBackoffMs);
    const jitter = 1 + ((this.#options.random() * 2) - 1) * this.#options.jitterRatio;
    this.#schedule(Math.max(1, Math.round(base * jitter)));
  }
}
