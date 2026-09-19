import Fastify, { type FastifyInstance } from 'fastify';
import { type AppConfig } from '../config/config.js';

export function buildApp(config: AppConfig): FastifyInstance {
  const app = Fastify({
    logger: config.logLevel === 'silent' ? false : { level: config.logLevel },
    bodyLimit: 64 * 1024
  });

  app.get('/health/live', () => ({ ok: true }));
  app.get('/health/ready', () => ({ ok: true }));
  app.get('/api/v1/overview', (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return {
      overall: 'monitoring-incomplete' as const,
      title: 'No integrations configured' as const,
      message: 'Configure a supported integration to begin monitoring.'
    };
  });

  return app;
}
