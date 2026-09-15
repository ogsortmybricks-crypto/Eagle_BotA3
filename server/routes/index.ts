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

export const apiRouter = Router();

// Resolving the studio needs a signed-in user, so it runs on everything and
// no-ops when there isn't one. `/auth/me` reads it, which is why it sits here
// rather than only on the authenticated routers below.
apiRouter.use(attachStudioScope);

// Open: the setup wizard, sign-in, and invite acceptance.
apiRouter.use("/setup", setupRouter);
apiRouter.use("/auth", authRouter);

// Everything else needs a session.
apiRouter.use("/studios", requireAuth, studiosRouter);
apiRouter.use("/settings", requireAuth, settingsRouter);
apiRouter.use("/wiki", requireAuth, wikiRouter);
apiRouter.use("/town-hall", requireAuth, townHallRouter);
apiRouter.use("/elections", requireAuth, electionsRouter);
apiRouter.use("/positions", requireAuth, positionsRouter);
apiRouter.use("/profiles", requireAuth, profilesRouter);
apiRouter.use("/admin", requireAuth, adminRouter);

apiRouter.use((_req, res) => {
  res.status(404).json({ error: "No such endpoint." });
});
