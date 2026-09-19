import { loadConfig } from './config/config.js';
import { buildApp } from './http/app.js';

const config = loadConfig(process.env);
const app = buildApp(config);

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error({ err: error }, 'server startup failed');
  process.exitCode = 1;
}
