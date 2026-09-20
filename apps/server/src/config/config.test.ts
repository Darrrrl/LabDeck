import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

  it('resolves an optional host snapshot path', () => {
    expect(loadConfig({ LABDECK_HOST_SNAPSHOT_PATH: './snapshot.json' }).hostSnapshotPath).toMatch(/snapshot\.json$/);
  });

  it('loads Jellyfin credentials from a restricted server-side file and preserves path prefixes', () => {
    const directory = mkdtempSync(join(tmpdir(), 'labdeck-config-')); const keyPath = join(directory, 'jellyfin-key');
    writeFileSync(keyPath, 'secret-value\n', { mode: 0o600 }); chmodSync(keyPath, 0o600);
    const config = loadConfig({ LABDECK_JELLYFIN_BASE_URL: 'http://jellyfin.test/jellyfin/', LABDECK_JELLYFIN_BROWSER_URL: 'https://media.test/web/', LABDECK_JELLYFIN_API_KEY_FILE: keyPath });
    expect(config.jellyfin).toMatchObject({ baseUrl: 'http://jellyfin.test/jellyfin', browserUrl: 'https://media.test/web', apiKey: 'secret-value' });
  });

  it('rejects partial Jellyfin configuration and URL credentials', () => {
    expect(() => loadConfig({ LABDECK_JELLYFIN_BASE_URL: 'http://jellyfin.test' })).toThrow(/configured together/);
    const directory = mkdtempSync(join(tmpdir(), 'labdeck-config-')); const keyPath = join(directory, 'key'); writeFileSync(keyPath, 'secret', { mode: 0o600 });
    expect(() => loadConfig({ LABDECK_JELLYFIN_BASE_URL: 'http://user:pass@jellyfin.test', LABDECK_JELLYFIN_BROWSER_URL: 'https://media.test', LABDECK_JELLYFIN_API_KEY_FILE: keyPath })).toThrow(/without credentials/);
    expect(() => loadConfig({ LABDECK_JELLYFIN_BASE_URL: 'http://169.254.1.2', LABDECK_JELLYFIN_BROWSER_URL: 'https://media.test', LABDECK_JELLYFIN_API_KEY_FILE: keyPath })).toThrow(/link-local metadata/);
  });
});
