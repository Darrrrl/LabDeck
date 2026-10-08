import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createConnection } from 'node:net';
import { YoutubeMonitor, youtubeOperation } from './youtube-control.js';

vi.mock('node:net', () => ({ createConnection: vi.fn() }));
const connect = vi.mocked(createConnection);

class Socket extends EventEmitter {
  constructor(private readonly reply: string | Error | null) { super(); queueMicrotask(() => this.emit('connect')); }
  setTimeout() { return this; }
  end() { queueMicrotask(() => { if (this.reply === null) return; if (this.reply instanceof Error) this.emit('error', this.reply); else { this.emit('data', Buffer.from(this.reply)); this.emit('end'); } this.emit('close'); }); }
  destroy(error: Error) { this.emit('error', error); this.emit('close'); }
}
function reply(value: string | Error | null) { connect.mockImplementationOnce(() => new Socket(value) as unknown as ReturnType<typeof createConnection>); }
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

describe('YouTube cached worker state', () => {
  it('preserves last good evidence on poll failure and never polls on reads', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-08T10:00:00Z'));
    reply(JSON.stringify({ ok: true, jobs: [] }));
    const monitor = new YoutubeMonitor('/fixture.sock');
    monitor.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(monitor.read()).toEqual({ configured: true, available: true, observedAt: '2026-10-08T10:00:00.000Z', jobs: [] });
    for (let index = 0; index < 10; index++) monitor.read();
    expect(connect).toHaveBeenCalledTimes(1);
    reply(new Error('offline'));
    await vi.advanceTimersByTimeAsync(5000);
    expect(monitor.read()).toEqual({ configured: true, available: false, observedAt: '2026-10-08T10:00:00.000Z', jobs: [] });
    await monitor.stop();
  });
  it('rejects malformed and oversized worker replies', async () => {
    reply(JSON.stringify({ ok: true, jobs: [], extra: '/secret' }));
    await expect(youtubeOperation('/fixture.sock', { action: 'status' })).rejects.toThrow('worker-rejected');
    reply('x'.repeat(64 * 1024 ** 2 + 1));
    await expect(youtubeOperation('/fixture.sock', { action: 'status' })).rejects.toThrow('response-too-large');
  });
  it('enforces an absolute command deadline', async () => {
    vi.useFakeTimers();
    reply(null);
    const outcome = expect(youtubeOperation('/fixture.sock', { action: 'status' })).rejects.toThrow('worker-timeout');
    await vi.advanceTimersByTimeAsync(5000);
    await outcome;
  });
});
