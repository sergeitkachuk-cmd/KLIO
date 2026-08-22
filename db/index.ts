import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

let client: ReturnType<typeof postgres> | undefined;

function createPostgresClient(connectionString: string, max: number) {
  try {
    // Keep the normal path for valid PostgreSQL URLs.
    new URL(connectionString);
    return postgres(connectionString, {
      max,
      ssl: process.env.NODE_ENV === "production" ? "require" : undefined,
    });
  } catch {
    // Some managed-DB panels place raw special characters in the password.
    // Node's URL parser rejects those URLs, so parse the known PostgreSQL
    // shape and pass credentials as separate driver options instead.
    const match = /^postgres(?:ql):\/\/([^:/?#]+):(.+)@([^:/?#]+):(\d+)\/([^?]+)(?:\?.*)?$/.exec(connectionString);
    if (!match) throw new Error("DATABASE_URL is not a valid PostgreSQL connection string.");

    let password = match[2];
    try {
      password = decodeURIComponent(password);
    } catch {
      // Keep raw passwords containing literal percent characters unchanged.
    }

    return postgres({
      host: match[3],
      port: Number(match[4]),
      database: match[5],
      username: decodeURIComponent(match[1]),
      password,
      max,
      ssl: process.env.NODE_ENV === "production" ? "require" : undefined,
    });
  }
}

export function getDb() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_URL is not configured.");

  client ??= createPostgresClient(connectionString, Number(process.env.DATABASE_POOL_SIZE || 5));
  return drizzle(client, { schema });
}
