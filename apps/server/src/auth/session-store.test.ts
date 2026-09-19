import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../db/database.js';
import { SessionStore } from './session-store.js';

const databases: ReturnType<typeof openDatabase>[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

describe('SessionStore', () => {
  it('stores token hashes and expires sessions', () => {
    let now = 1_000;
    const database = openDatabase(':memory:'); databases.push(database);
    const store = new SessionStore(database, () => now);
    store.reconcilePasswordHash('$argon2id$one');
    const session = store.create();
    expect(store.verify(session.token)).toBe(true);
    expect(JSON.stringify(database.prepare('SELECT * FROM sessions').get())).not.toContain(session.token);
    now += 8 * 60 * 60 * 1000;
    expect(store.verify(session.token)).toBe(false);
  });

  it('clears sessions when the configured password hash changes', () => {
    const database = openDatabase(':memory:'); databases.push(database);
    const store = new SessionStore(database);
    store.reconcilePasswordHash('$argon2id$one');
    const session = store.create();
    store.reconcilePasswordHash('$argon2id$two');
    expect(store.verify(session.token)).toBe(false);
  });
});
