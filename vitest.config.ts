import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['apps/**/*.test.{ts,tsx}', 'packages/**/*.test.{ts,tsx}'],
          exclude: ['apps/**/*.integration.test.ts']
        }
      },
      {
        extends: true,
        test: {
          name: 'foundation',
          include: ['apps/**/*.integration.test.ts'],
          exclude: ['apps/**/*.host.integration.test.ts', 'apps/**/*.jellyfin.integration.test.ts']
        }
      },
      {
        extends: true,
        test: {
          name: 'host',
          include: ['apps/**/*.host.integration.test.ts']
        }
      },
      {
        extends: true,
        test: {
          name: 'jellyfin',
          include: ['apps/**/*.jellyfin.integration.test.ts']
        }
      }
    ]
  }
});
