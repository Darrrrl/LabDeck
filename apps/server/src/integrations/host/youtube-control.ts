import { createConnection } from 'node:net';
import { youtubeReplySchema, type YoutubeJob } from '@labdeck/contracts';

export function youtubeOperation(path: string, request: Record<string, unknown>) {
  return new Promise<ReturnType<typeof youtubeReplySchema.parse>>((resolve, reject) => {
    const socket = createConnection(path);
    const chunks: Buffer[] = [];
    let size = 0;
    const deadline = setTimeout(() => socket.destroy(new Error('worker-timeout')), 5000);
    deadline.unref();
    socket.once('close', () => clearTimeout(deadline));
    socket.on('connect', () => socket.end(`${JSON.stringify(request)}\n`));
    socket.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 64 * 1024 * 1024) socket.destroy(new Error('response-too-large'));
      else chunks.push(chunk);
    });
    socket.on('error', reject);
    socket.on('end', () => {
      try { resolve(youtubeReplySchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')))); }
      catch { reject(new Error('worker-rejected')); }
    });
  });
}

export class YoutubeMonitor {
  private timer?: ReturnType<typeof setInterval>;
  private inFlight = false;
  private closed = false;
  private pending: Promise<void> = Promise.resolve();
  private jobs: YoutubeJob[] = [];
  private observedAt: string | null = null;
  private available = false;
  constructor(private readonly path: string) {}
  start() { this.schedule(); this.timer = setInterval(() => { this.schedule(); }, 5000); this.timer.unref(); }
  async stop() { this.closed = true; clearInterval(this.timer); await this.pending; }
  read() { return { configured: true, available: this.available, observedAt: this.observedAt, jobs: this.jobs }; }
  private schedule() { if (!this.inFlight && !this.closed) this.pending = this.refresh(); }
  private async refresh() {
    if (this.inFlight || this.closed) return;
    this.inFlight = true;
    try {
      const reply = await youtubeOperation(this.path, { action: 'status' });
      if (!reply.jobs) throw new Error('invalid-status');
      this.jobs = reply.jobs; this.observedAt = new Date().toISOString(); this.available = true;
    } catch { this.available = false; }
    finally { this.inFlight = false; }
  }
}
