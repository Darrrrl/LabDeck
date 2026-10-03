import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from './database.js';

const databases: ReturnType<typeof openDatabase>[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

describe('database migrations', () => {
  it('creates the initial schema idempotently', () => {
    const database = openDatabase(':memory:'); databases.push(database);
    expect(database.prepare('SELECT version FROM schema_migrations ORDER BY version').all()).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }, { version: 5 }, { version: 6 }]);
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'").get()).toBeDefined();
  });
});
