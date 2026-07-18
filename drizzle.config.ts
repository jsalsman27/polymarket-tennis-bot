import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_URL ?? "file:./data/dev.db";
const authToken = process.env.DATABASE_AUTH_TOKEN;

// Use the libsql/Turso driver when pointed at a remote libsql:// URL (needs an
// auth token); fall back to the plain SQLite file driver for local dev.
const isRemote = url.startsWith("libsql://") || url.startsWith("https://");

export default defineConfig({
  schema: "./lib/schema.ts",
  out: "./drizzle",
  dialect: isRemote ? "turso" : "sqlite",
  dbCredentials: isRemote ? { url, authToken } : { url },
});
