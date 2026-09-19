import { defineConfig, devices } from '@playwright/test';

const testHash = '$argon2id$v=19$m=65536,p=1,t=3$PXDMM1y9CUS549GqcAsCIQ$PgQGp+iBmC4kveyVEw2MwyhoJy0hx108+lkBKFySRng';

export default defineConfig({
  testDir: './tests/e2e', timeout: 30_000, fullyParallel: false, workers: 1,
  use: { baseURL: 'http://127.0.0.1:7338', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node apps/server/dist/index.js', url: 'http://127.0.0.1:7338/health/ready', reuseExistingServer: false,
    env: {
      LABDECK_HOST: '127.0.0.1', LABDECK_PORT: '7338', LABDECK_LOG_LEVEL: 'silent', LABDECK_DATABASE_PATH: ':memory:',
      LABDECK_CANONICAL_ORIGIN: 'http://127.0.0.1:7338', LABDECK_ALLOWED_HOSTS: '127.0.0.1:7338', LABDECK_OWNER_PASSWORD_HASH: testHash,
      LABDECK_DEMO_MODE: 'true', LABDECK_WEB_ROOT: './apps/web/dist', LABDECK_HOST_SNAPSHOT_PATH: './tests/fixtures/host/system-v1.json'
    }
  }
});
