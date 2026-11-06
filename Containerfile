FROM docker.io/library/node:22-slim
WORKDIR /app
ENV DB_PATH=/data/nighttable.db
COPY package*.json ./
RUN npm install --omit=dev
COPY backend ./backend
COPY shared ./shared
RUN chmod -R a+rX /app
USER node
VOLUME ["/data"]
EXPOSE 8080
CMD ["node", "backend/server.js"]
