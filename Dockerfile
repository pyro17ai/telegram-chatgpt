FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build:server
FROM node:24-bookworm-slim
ENV NODE_ENV=production TRUST_PROXY=1 HOST=0.0.0.0 PORT=3000 DATA_DIR=/app/data
WORKDIR /app
COPY --from=build --chown=node:node /app/dist/node ./dist/node
COPY --from=build --chown=node:node /app/drizzle ./drizzle
RUN mkdir /app/data && chown node:node /app/data
USER node
EXPOSE 3000
CMD ["node", "dist/node/server.mjs"]
