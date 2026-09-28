// Plain-JS twin of what used to be namespace.ts, same reason connection.mjs
// exists: scripts/prepare-database.mjs runs as plain Node at container boot
// (no TypeScript loader), so anything it needs at runtime - including this,
// once migrateFeedbackThreads() needed to target the right schema too -
// has to be importable without one. db/index.ts, db/schema.ts and
// drizzle.config.ts (all real TypeScript) import this exact file too,
// rather than each having their own copy.

/**
 * A preview has its own tables inside the existing database, never in public.
 * @param {Record<string, string | undefined>} [env]
 * @returns {string}
 */
export function getDatabaseSchemaName(env = process.env) {
  const value = env.KLIO_PREVIEW_SCHEMA?.trim();
  if (!value) return "public";
  if (!/^klio_preview_[a-z0-9_]{1,40}$/.test(value)) {
    throw new Error(
      "KLIO_PREVIEW_SCHEMA must start with klio_preview_ and contain only lowercase letters, numbers and underscores.",
    );
  }
  return value;
}
