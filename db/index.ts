import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { getDatabaseSchemaName } from "./namespace";
import { parseDatabaseConnection } from "./connection.mjs";

let client: ReturnType<typeof postgres> | undefined;

function createPostgresClient(connectionString: string, max: number) {
  const schemaName = getDatabaseSchemaName();
  // No fallback to public: a missing preview table must fail, not use client data.
  const connection = schemaName === "public" ? undefined : { search_path: schemaName };
  const options = {
    max,
    ssl: process.env.NODE_ENV === "production" ? "require" as const : undefined,
    connection,
  };
  try {
    // Preserve driver-supported URI options on valid URLs (including local SSL).
    new URL(connectionString);
    return postgres(connectionString, options);
  } catch {
    return postgres({ ...parseDatabaseConnection(connectionString), ...options });
  }
}

export function getDb() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_URL is not configured.");

  client ??= createPostgresClient(connectionString, Number(process.env.DATABASE_POOL_SIZE || 5));
  return drizzle(client, { schema });
}
