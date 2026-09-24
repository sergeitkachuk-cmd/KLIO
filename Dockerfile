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
COPY --from=builder /app/certs ./certs
# drizzle.config.ts + db/schema.ts, needed for "npm run db:push" at startup
# below. Timeweb has no separate pre-deploy hook. The old Render Blueprint
# configuration is archived in render.yaml.legacy; the current Render service
# is only the Telegram + image/GPT relay and does not run this image. Running
# the push as part of this container's own startup keeps schema changes and
# the application release in sync.
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder /app/db ./db
COPY --from=builder /app/scripts/prepare-database.mjs ./scripts/prepare-database.mjs

EXPOSE 3000
# db:push wraps non-interactive Drizzle push and requires an explicit success
# marker as well as exit code 0; this Drizzle version can exit 0 on an error.
CMD ["sh", "-c", "npm run db:push && npm start"]
