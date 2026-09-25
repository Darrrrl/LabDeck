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
          exclude: ['apps/**/*.host.integration.test.ts', 'apps/**/*.jellyfin.integration.test.ts', 'apps/**/*.arr.integration.test.ts', 'apps/**/*.network.integration.test.ts', 'apps/**/*.persistence.integration.test.ts']
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
      },
      {
        extends: true,
        test: { name: 'arr', include: ['apps/**/*.arr.integration.test.ts'] }
      },
      {
        extends: true,
        test: { name: 'prowlarr', include: ['apps/**/*.prowlarr.integration.test.ts'] }
      },
      {
        extends: true,
        test: { name: 'docker', include: ['apps/**/*.docker.integration.test.ts'] }
      },
      {
        extends: true,
        test: { name: 'smart', include: ['apps/**/*.smart.integration.test.ts'] }
      },
      {
        extends: true,
        test: { name: 'network', include: ['apps/**/*.network.integration.test.ts'] }
      },
      {
        extends: true,
        test: { name: 'persistence', include: ['apps/**/*.persistence.integration.test.ts'] }
      }
    ]
  }
});
