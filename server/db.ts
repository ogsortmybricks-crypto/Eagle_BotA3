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

// Hosted Postgres closes connections that sit idle. The pool notices, drops
// that connection and opens a fresh one for the next query - but only if
// something listens for the error. Unheard, it ends the whole process.
pool.on("error", (error) => {
  console.error("[db] an idle database connection was closed; the pool will open a new one", error.message);
});

export const db = drizzle(pool, { schema });

export type Db = typeof db;
