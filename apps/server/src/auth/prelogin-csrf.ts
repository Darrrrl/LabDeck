import { createHash, randomBytes } from 'node:crypto';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

export class PreloginCsrfStore {
  private readonly entries = new Map<string, { hash: string; expiresAt: number }>();
  constructor(private readonly now: () => number = Date.now) {}
  issue(): { context: string; token: string } {
    this.prune();
    while (this.entries.size >= 1000) this.entries.delete(this.entries.keys().next().value as string);
    const context = randomBytes(24).toString('base64url');
    const token = randomBytes(32).toString('base64url');
    this.entries.set(context, { hash: digest(token), expiresAt: this.now() + 600_000 });
    return { context, token };
  }
  consume(context: string | undefined, token: string | undefined): boolean {
    if (!context || !token) return false;
    const entry = this.entries.get(context); this.entries.delete(context);
    return entry !== undefined && entry.expiresAt > this.now() && entry.hash === digest(token);
  }
  private prune(): void {
    for (const [context, entry] of this.entries) if (entry.expiresAt <= this.now()) this.entries.delete(context);
  }
}
