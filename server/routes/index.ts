import { Router } from "express";
import { requireAuth } from "../auth";
import { attachStudioScope } from "../studio";
import { setupRouter } from "./setup";
import { authRouter } from "./auth";
import { studiosRouter } from "./studios";
import { settingsRouter } from "./settings";
import { wikiRouter } from "./wiki";
import { townHallRouter } from "./townhall";
import { electionsRouter } from "./elections";
import { positionsRouter } from "./positions";
import { adminRouter } from "./admin";
import { profilesRouter } from "./profiles";
import { taconsRouter } from "./tacons";
import { portalRouter } from "./portal";
import { registerPublicExtensionRoutes } from "../tacons/extensions";
import { meRouter } from "./me";
import { calendarRouter } from "./calendar";
import { billingRouter } from "./billing";
import { supportRouter } from "./support";
import { requireWritable } from "../billing";

export const apiRouter = Router();

registerPublicExtensionRoutes(apiRouter);

// Resolving the studio needs a signed-in user, so it runs on everything and
// no-ops when there isn't one. `/auth/me` reads it, which is why it sits here
// rather than only on the authenticated routers below.
apiRouter.use(attachStudioScope);

// Open: the setup wizard, sign-in, and invite acceptance.
apiRouter.use("/setup", setupRouter);
apiRouter.use("/auth", authRouter);

// The dev portal signs in on its own credentials, so it can't sit behind the
// academy's requireAuth. It guards itself.
apiRouter.use("/portal", portalRouter);

// Plans, the survey and the Help button stay open after a demo ends - they're
// how an academy gets out of read-only, or asks why it's in it.
apiRouter.use("/billing", requireAuth, billingRouter);
apiRouter.use("/support", requireAuth, supportRouter);

// Everything else needs a session, and turns read-only once a demo has ended
// unpaid. See server/billing.ts.
apiRouter.use("/me", requireAuth, requireWritable, meRouter);
apiRouter.use("/studios", requireAuth, requireWritable, studiosRouter);
apiRouter.use("/settings", requireAuth, requireWritable, settingsRouter);
apiRouter.use("/wiki", requireAuth, requireWritable, wikiRouter);
apiRouter.use("/town-hall", requireAuth, requireWritable, townHallRouter);
apiRouter.use("/elections", requireAuth, requireWritable, electionsRouter);
apiRouter.use("/positions", requireAuth, requireWritable, positionsRouter);
apiRouter.use("/calendar", requireAuth, requireWritable, calendarRouter);
apiRouter.use("/profiles", requireAuth, requireWritable, profilesRouter);
apiRouter.use("/admin", requireAuth, requireWritable, adminRouter);
apiRouter.use("/tacons", requireAuth, requireWritable, taconsRouter);

apiRouter.use((_req, res) => {
  res.status(404).json({ error: "No such endpoint." });
});
