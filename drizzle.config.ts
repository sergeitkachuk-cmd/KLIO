import { defineConfig } from "drizzle-kit";

// Render's managed Postgres (and most hosted providers) require SSL.
// Only skip it for the local-dev fallback URL below.
const databaseUrl = process.env.DATABASE_URL || "postgresql://localhost/klio";

export default defineConfig({
  out: "./drizzle-postgres",
  schema: "./db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
    ssl: process.env.DATABASE_URL ? "require" : false,
  },
});
