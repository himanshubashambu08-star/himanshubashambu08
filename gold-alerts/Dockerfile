# ---- build ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
# Toolchain only used if better-sqlite3 has no prebuilt binary for this CPU (e.g. some ARM boards).
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ---- run ----
FROM node:22-bookworm-slim
ENV NODE_ENV=production TZ=America/Toronto
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends tzdata ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY config ./config
# SQLite database + WhatsApp login session. Mount a volume here so restarts don't need a new QR scan.
RUN mkdir -p /app/data && chown node:node /app/data
VOLUME ["/app/data"]
USER node
CMD ["node", "dist/index.js"]
