import { createHash, randomBytes } from 'node:crypto';
import type Database from 'better-sqlite3';

const SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

export interface SessionRecord { token: string; csrfToken: string; expiresAt: number }

export class SessionStore {
  constructor(private readonly database: Database.Database, private readonly now: () => number = Date.now) {}

  reconcilePasswordHash(passwordHash: string): void {
    const fingerprint = digest(passwordHash);
    this.database.transaction(() => {
      const existing = this.database.prepare('SELECT password_fingerprint FROM auth_state WHERE id = 1').get() as { password_fingerprint: string } | undefined;
      if (existing && existing.password_fingerprint !== fingerprint) this.database.prepare('DELETE FROM sessions').run();
      this.database.prepare(`INSERT INTO auth_state(id, password_fingerprint) VALUES (1, ?)
        ON CONFLICT(id) DO UPDATE SET password_fingerprint = excluded.password_fingerprint`).run(fingerprint);
    })();
  }

  create(): SessionRecord {
    this.prune();
    const token = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(32).toString('base64url');
    const expiresAt = this.now() + SESSION_LIFETIME_MS;
    this.database.prepare('INSERT INTO sessions(token_hash, csrf_hash, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(digest(token), digest(csrfToken), this.now(), expiresAt);
    return { token, csrfToken, expiresAt };
  }

  verify(token: string | undefined): boolean {
    if (!token) return false;
    const row = this.database.prepare('SELECT expires_at FROM sessions WHERE token_hash = ?').get(digest(token)) as { expires_at: number } | undefined;
    return row !== undefined && row.expires_at > this.now();
  }

  verifyCsrf(token: string | undefined, csrfToken: string | undefined): boolean {
    if (!token || !csrfToken) return false;
    const row = this.database.prepare('SELECT csrf_hash, expires_at FROM sessions WHERE token_hash = ?').get(digest(token)) as { csrf_hash: string; expires_at: number } | undefined;
    return row !== undefined && row.expires_at > this.now() && row.csrf_hash === digest(csrfToken);
  }

  rotateCsrf(token: string | undefined): string | undefined {
    if (!this.verify(token) || !token) return undefined;
    const csrfToken = randomBytes(32).toString('base64url');
    this.database.prepare('UPDATE sessions SET csrf_hash = ? WHERE token_hash = ?').run(digest(csrfToken), digest(token));
    return csrfToken;
  }

  delete(token: string | undefined): void {
    if (token) this.database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(digest(token));
  }

  prune(): void {
    this.database.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(this.now());
    this.database.prepare(`DELETE FROM sessions WHERE token_hash IN (
      SELECT token_hash FROM sessions ORDER BY created_at DESC LIMIT -1 OFFSET 1000
    )`).run();
  }
}
