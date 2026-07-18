import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

const url = process.env.DATABASE_URL ?? "file:./data/dev.db";
const authToken = process.env.DATABASE_AUTH_TOKEN;

const client = createClient(
  authToken ? { url, authToken } : { url }
);

export const db = drizzle(client, { schema });
