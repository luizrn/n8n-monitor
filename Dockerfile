FROM node:22-alpine

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    N8N_MONITOR_DATA_DIR=/data

WORKDIR /app

COPY --chown=node:node package.json ./*.mjs ./
COPY --chown=node:node public ./public
COPY --chown=node:node scripts ./scripts

RUN mkdir -p /data && chown node:node /data

USER node
EXPOSE 8787
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8787/api/health >/dev/null || exit 1

STOPSIGNAL SIGTERM
CMD ["node", "server.mjs"]
