import "./async-errors";
import express, { type NextFunction, type Request, type Response } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { env, aiConfigured, emailConfigured } from "./env";
import { pool } from "./db";
import { attachUser } from "./auth";
import { apiRouter } from "./routes";
import { recoverStuckJobs } from "./ai/jobs";
import { TaconAccessError } from "./tacons/governance";

const here = path.dirname(fileURLToPath(import.meta.url));

// Work that runs outside a request (a Tac-On reacting to an event, a
// background job) can still fail without a handler. That is one bug to log,
// not a reason to take the whole academy's Eagle Bot offline.
process.on("unhandledRejection", (reason) => {
  console.error("[server] a background task failed", reason);
});

async function main() {
  const app = express();

  app.set("trust proxy", 1);
  // Data-URL logos and avatars travel as JSON, so the limit is generous.
  app.use(express.json({ limit: "8mb" }));
  app.use(express.urlencoded({ extended: false, limit: "8mb" }));

  const PgSession = connectPgSimple(session);
  app.use(
    session({
      store: new PgSession({ pool, tableName: "user_sessions", createTableIfMissing: true }),
      secret: env.sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: env.isProduction,
        maxAge: 30 * 24 * 60 * 60 * 1000,
      },
    }),
  );

  app.use(attachUser);

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, ai: aiConfigured, email: emailConfigured });
  });

  app.use("/api", apiRouter);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (!(error instanceof TaconAccessError)) console.error("[server] unhandled error", error);
    if (res.headersSent) return;
    const message = error instanceof Error ? error.message : "Something went wrong.";
    res.status(error instanceof TaconAccessError ? error.status : 500).json({ error: message });
  });

  if (env.isProduction) {
    const publicDir = path.resolve(here, "public");
    if (!fs.existsSync(publicDir)) {
      throw new Error(`Client build not found at ${publicDir}. Run "npm run build" first.`);
    }
    app.use(express.static(publicDir));
    // The client owns routing; everything non-API falls through to index.html.
    app.get("*", (_req, res) => res.sendFile(path.join(publicDir, "index.html")));
  } else {
    const { createServer } = await import("vite");
    const vite = await createServer({
      configFile: path.resolve(here, "..", "vite.config.ts"),
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  await recoverStuckJobs().catch((error) =>
    console.error("[boot] couldn't clean up interrupted jobs", error),
  );

  app.listen(env.port, "0.0.0.0", () => {
    console.log(`\n  Eagle Bot running on http://localhost:${env.port}`);
    console.log(`  AI:    ${aiConfigured ? `on (${env.anthropicModel})` : "off - set ANTHROPIC_API_KEY"}`);
    console.log(`  Email: ${emailConfigured ? "on" : "off - set SMTP_USER and SMTP_PASS"}\n`);
  });
}

main().catch((error) => {
  console.error("Failed to start Eagle Bot:", error);
  process.exit(1);
});
