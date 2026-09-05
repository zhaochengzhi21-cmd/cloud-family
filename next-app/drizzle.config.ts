import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit config for Cloud Family V1.
 * Migrations: schema → generate → review SQL → migrate.
 * Do NOT use drizzle-kit push against Production.
 */
export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.V1_DATABASE_URL!,
  },
  strict: true,
  verbose: true,
});
