FROM docker.io/library/node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV DB_PATH=/data/nighttable.db

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY backend ./backend
COPY shared ./shared

RUN mkdir -p /data \
  && chown -R node:node /app /data

USER node

VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/health').then(r => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1))"]

STOPSIGNAL SIGTERM
CMD ["node", "backend/server.js"]
