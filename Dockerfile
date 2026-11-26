# BHUMI · servidor central
FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app

# Solo dependencias de ejecución (esbuild y sql.js son para armar la versión de doble clic).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY server ./server
COPY public ./public

# La base vive en un volumen: sobrevive a actualizaciones del contenedor.
ENV HOST=0.0.0.0 \
    PORT=3000 \
    DB_FILE=/datos/bhumi.db
RUN mkdir -p /datos && chown node:node /datos
VOLUME /datos

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/salud || exit 1

CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
