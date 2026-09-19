export class LoginLimiter {
  private readonly attempts = new Map<string, number[]>();
  constructor(private readonly now: () => number = Date.now) {}
  allow(key: string): boolean {
    const cutoff = this.now() - 60_000;
    const global = (this.attempts.get('*') ?? []).filter((time) => time > cutoff);
    const local = (this.attempts.get(key) ?? []).filter((time) => time > cutoff);
    if (global.length >= 30 || local.length >= 5) return false;
    const time = this.now(); global.push(time); local.push(time);
    this.attempts.set('*', global); this.attempts.set(key, local);
    return true;
  }
}
