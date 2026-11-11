FROM docker.io/library/node:22-bookworm-slim AS build

WORKDIR /app

# better-sqlite3 can compile locally when no prebuilt binary is available.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY . .
RUN npm run build && npm prune --omit=dev

FROM docker.io/library/node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATABASE_PATH=/app/data/housik.sqlite \
    UPLOAD_DIR=/app/data/receipts \
    BODY_SIZE_LIMIT=12M

WORKDIR /app
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/build ./build
RUN install -d -m 0700 -o node -g node /app/data

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["node", "--input-type=module", "-e", "const response = await fetch('http://127.0.0.1:3000/'); if (!response.ok) process.exit(1);"]
CMD ["node", "build"]
