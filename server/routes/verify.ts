import { Router } from "express";
import { lookupVerification } from "../tacons/partners-work";

/**
 * Public verification links: `/verify/<token>`, pasted into Journey Tracker.
 * Anyone with the link can open it, so it says as little as proves the point.
 */
export const verifyRouter = Router();

// A crude per-address limit. Tokens are 144 random bits, so this is about
// keeping the endpoint cheap, not about the tokens being guessable.
const hits = new Map<string, { count: number; reset: number }>();

verifyRouter.get("/:token", async (req, res) => {
  const key = req.ip ?? "unknown";
  const now = Date.now();
  const entry = hits.get(key);
  if (!entry || entry.reset < now) hits.set(key, { count: 1, reset: now + 60_000 });
  else if (++entry.count > 60) return res.status(429).json({ error: "Too many requests. Try again in a minute." });
  if (hits.size > 10_000) for (const [ip, value] of hits) if (value.reset < now) hits.delete(ip);

  const found = await lookupVerification(req.params.token);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");
  if (!found) {
    return res.status(404).json({ error: "This verification link isn't valid. It may have been taken back." });
  }
  res.json({ verification: found });
});
