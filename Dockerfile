FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN QODER_SKIP_DOWNLOAD=1 npm ci
COPY tsconfig.json vite.config.ts ./
COPY packages ./packages
COPY apps ./apps
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 RAW_DIRECTORY=/data/raw
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
RUN mkdir -p /data/raw && chown -R node:node /data
USER node
EXPOSE 3000
CMD ["node", "dist/apps/server/main.js"]
