import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('defaults to loopback', () => {
    expect(loadConfig({})).toMatchObject({ host: '127.0.0.1', port: 7337 });
  });

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ LABDECK_PORT: '70000' })).toThrow();
  });
});
