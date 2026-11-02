FROM docker.io/library/node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
RUN chmod -R a+rX /app
USER node
EXPOSE 8080
CMD ["node", "index.js"]
