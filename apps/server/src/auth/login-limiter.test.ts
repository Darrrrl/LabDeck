import { describe, expect, it } from 'vitest';
import { LoginLimiter } from './login-limiter.js';

describe('LoginLimiter', () => {
  it('limits each source independently', () => {
    const limiter = new LoginLimiter(() => 100_000);
    for (let attempt = 0; attempt < 5; attempt += 1) expect(limiter.allow('127.0.0.1')).toBe(true);
    expect(limiter.allow('127.0.0.1')).toBe(false);
    expect(limiter.allow('127.0.0.2')).toBe(true);
  });
});
