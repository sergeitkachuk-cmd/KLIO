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
# Next.js embeds this public domain key into the browser bundle at build time.
ARG NEXT_PUBLIC_CHATKIT_DOMAIN_KEY
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
# below. This host has no separate pre-deploy hook (unlike Render's
# render.yaml preDeployCommand, which this image used to rely on and which
# never actually ran here) — a schema change landed in code with no way to
# reach the live database until a container restart, breaking every
# accounts-table query in production on 2026-08-27. Running the push as
# part of the container's own startup closes that gap.
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder /app/db ./db
COPY --from=builder /app/scripts/prepare-database.mjs ./scripts/prepare-database.mjs

EXPOSE 3000
# db:push wraps non-interactive Drizzle push and requires an explicit success
# marker as well as exit code 0; this Drizzle version can exit 0 on an error.
CMD ["sh", "-c", "npm run db:push && npm start"]
