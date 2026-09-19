FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci
COPY tsconfig.json tsconfig.base.json eslint.config.js vitest.config.ts ./
COPY apps ./apps
COPY packages ./packages
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production LABDECK_HOST=0.0.0.0 LABDECK_PORT=7337 LABDECK_WEB_ROOT=/app/apps/web/dist
WORKDIR /app
RUN groupadd --gid 10001 labdeck && useradd --uid 10001 --gid labdeck --no-create-home --shell /usr/sbin/nologin labdeck
COPY --from=build --chown=labdeck:labdeck /app/package.json /app/package-lock.json ./
COPY --from=build --chown=labdeck:labdeck /app/node_modules ./node_modules
COPY --from=build --chown=labdeck:labdeck /app/apps/server/package.json ./apps/server/package.json
COPY --from=build --chown=labdeck:labdeck /app/apps/server/dist ./apps/server/dist
COPY --from=build --chown=labdeck:labdeck /app/apps/web/dist ./apps/web/dist
USER 10001:10001
EXPOSE 7337
CMD ["node", "apps/server/dist/index.js"]
