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
# Timeweb can use the image health status while routing the first deployment.
# Node 22 provides fetch, so this needs no extra curl package in the runtime image.
HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=6 CMD node -e "fetch('http://127.0.0.1:3000/api/ai-status').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["npm", "start"]
