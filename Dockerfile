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
# drizzle.config.ts + db/schema.ts, needed for "npm run db:push" at startup
# below. This host has no separate pre-deploy hook (unlike Render's
# render.yaml preDeployCommand, which this image used to rely on and which
# never actually ran here) — a schema change landed in code with no way to
# reach the live database until a container restart, breaking every
# accounts-table query in production on 2026-08-27. Running the push as
# part of the container's own startup closes that gap.
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder /app/db ./db

EXPOSE 3000
# --force is non-interactive (no TTY in a container to answer prompts) and
# is the same flag render.yaml already specified — this restores that
# behavior rather than introducing a new one. A failed push fails the
# container's startup instead of silently serving traffic against a
# mismatched schema.
CMD ["sh", "-c", "npm run db:push && npm start"]
