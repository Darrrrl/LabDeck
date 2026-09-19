import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('defaults to loopback', () => {
    const config = loadConfig({});
    expect(config).toMatchObject({ host: '127.0.0.1', port: 7337 });
    expect(config.passwordHash).toBeUndefined();
  });

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ LABDECK_PORT: '70000' })).toThrow();
  });

  it('rejects ambiguous secret sources', () => {
    expect(() => loadConfig({ LABDECK_OWNER_PASSWORD_HASH: '$argon2id$example', LABDECK_OWNER_PASSWORD_HASH_FILE: '/unused' })).toThrow(/one owner password hash source/);
  });

  it('requires demo mode to remain on loopback', () => {
    expect(() => loadConfig({ LABDECK_DEMO_MODE: 'true', LABDECK_HOST: '0.0.0.0' })).toThrow(/loopback/);
  });
});
