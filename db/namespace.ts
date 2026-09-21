/** A preview has its own tables inside the existing database, never in public. */
export function getDatabaseSchemaName(
  env: Record<string, string | undefined> = process.env,
): string {
  const value = env.KLIO_PREVIEW_SCHEMA?.trim();
  if (!value) return "public";
  if (!/^klio_preview_[a-z0-9_]{1,40}$/.test(value)) {
    throw new Error(
      "KLIO_PREVIEW_SCHEMA must start with klio_preview_ and contain only lowercase letters, numbers and underscores.",
    );
  }
  return value;
}
