FROM node:22-alpine

WORKDIR /app
COPY server/server.js ./
COPY index.html sw.js app.webmanifest app-192.png app-512.png ./www/
RUN mkdir -p /data && chown node:node /data

ENV PORT=3000 DATA_DIR=/data NODE_ENV=production
USER node
EXPOSE 3000
VOLUME /data
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://127.0.0.1:3000/healthz >/dev/null || exit 1
CMD ["node", "server.js"]
