/**
 * Errors thrown inside `async` route handlers reach the error handler.
 *
 * Express 4 only catches errors a handler throws synchronously. Every route in
 * this app is `async`, so a rejected promise - a dropped database connection,
 * a bug in one Tac-On page - used to become an unhandled rejection, and Node
 * ends the process on those. The whole server went down, and every request
 * until it restarted got a bare "Internal Server Error".
 *
 * This wraps the one place Express calls a handler, so a rejection is passed
 * to `next(error)` like a thrown error. Express 5 does the same itself; drop
 * this file when moving to it. Import it before any router is built.
 */

import { createRequire } from "node:module";

type Handler = (req: unknown, res: unknown, next: (error?: unknown) => void) => unknown;
type LayerClass = {
  prototype: { handle: Handler; handle_request: (req: unknown, res: unknown, next: (error?: unknown) => void) => void };
};

const Layer = createRequire(import.meta.url)("express/lib/router/layer.js") as LayerClass;

Layer.prototype.handle_request = function handleRequest(req, res, next) {
  const fn = this.handle;
  // Four arguments is an error handler; Express skips those here.
  if (fn.length > 3) return next();
  try {
    const result = fn(req, res, next);
    if (result && typeof (result as Promise<unknown>).catch === "function") {
      (result as Promise<unknown>).catch((error: unknown) => next(error ?? new Error("Request failed.")));
    }
  } catch (error) {
    next(error);
  }
};
