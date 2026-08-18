FROM node:22-alpine AS build

WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
COPY public ./public
COPY test ./test
RUN npm ci && npm run test:unit && npm run test:coleta && npm run test:html && npm run compile

# node_modules de producao em estagio proprio: sem isto o compilador, o tsx e o esbuild
# viajavam para a imagem final junto com o resto das devDependencies.
FROM node:22-alpine AS deps

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-alpine

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    N8N_MONITOR_DATA_DIR=/data

WORKDIR /app

COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node public ./public

RUN mkdir -p /data && chown node:node /data

USER node
EXPOSE 8787
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8787/api/health >/dev/null || exit 1

STOPSIGNAL SIGTERM
CMD ["node", "dist/server.js"]
