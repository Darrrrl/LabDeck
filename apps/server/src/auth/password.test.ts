import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';

describe('owner password', () => {
  it('creates and verifies only Argon2id hashes', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).toMatch(/^\$argon2id\$/);
    await expect(verifyPassword(hash, 'correct horse battery staple')).resolves.toBe(true);
    await expect(verifyPassword(hash, 'incorrect password')).resolves.toBe(false);
  });
});
