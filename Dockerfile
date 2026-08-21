# KLIO is a server-rendered Next.js application: build it in the image and
# keep runtime configuration (database and provider keys) in platform env vars.
FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public

EXPOSE 3000
# App Platform evaluates the container health status before publishing it.
# A TCP probe is intentionally independent of Next.js routing, the database,
# and AI-provider environment variables; it only succeeds once the server is
# actually listening on the exposed port.
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=6 CMD node -e "const socket = require('net').connect(3000, '127.0.0.1'); socket.on('connect', () => { socket.end(); process.exit(0); }); socket.on('error', () => process.exit(1));"
CMD ["npm", "start"]
