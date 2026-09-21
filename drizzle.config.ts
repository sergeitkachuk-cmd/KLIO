import { defineConfig } from "drizzle-kit";
import { getDatabaseSchemaName } from "./db/namespace";

// Render's managed Postgres (and most hosted providers) require SSL.
// Only skip it for the local-dev fallback URL below.
const databaseUrl = process.env.DATABASE_URL || "postgresql://localhost/klio";
const databaseSchemaName = getDatabaseSchemaName();

export default defineConfig({
  out: databaseSchemaName === "public" ? "./drizzle-postgres" : `./drizzle-postgres/${databaseSchemaName}`,
  schema: "./db/schema.ts",
  // Restrict both introspection and schema updates to this environment's tables.
  schemaFilter: [databaseSchemaName],
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
    ssl: process.env.DATABASE_URL ? "require" : false,
  },
});
