import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";
import { env } from "./env";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: env.databaseUrl,
  // Replit's managed Postgres and most hosted providers require TLS but use
  // certificates Node won't verify out of the box.
  ssl: /localhost|127\.0\.0\.1/.test(env.databaseUrl) ? false : { rejectUnauthorized: false },
});

export const db = drizzle(pool, { schema });

export type Db = typeof db;
