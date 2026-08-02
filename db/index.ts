import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

let client: ReturnType<typeof postgres> | undefined;

export function getDb() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_URL is not configured.");

  client ??= postgres(connectionString, {
    max: Number(process.env.DATABASE_POOL_SIZE || 5),
    ssl: process.env.NODE_ENV === "production" ? "require" : undefined,
  });
  return drizzle(client, { schema });
}
