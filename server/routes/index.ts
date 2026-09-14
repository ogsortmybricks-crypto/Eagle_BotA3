import { Router } from "express";
import { requireAuth } from "../auth";
import { setupRouter } from "./setup";
import { authRouter } from "./auth";
import { wikiRouter } from "./wiki";
import { townHallRouter } from "./townhall";
import { electionsRouter } from "./elections";
import { positionsRouter } from "./positions";
import { adminRouter } from "./admin";
import { profilesRouter } from "./profiles";

export const apiRouter = Router();

// Open: the setup wizard, sign-in, and invite acceptance.
apiRouter.use("/setup", setupRouter);
apiRouter.use("/auth", authRouter);

// Everything else needs a session.
apiRouter.use("/wiki", requireAuth, wikiRouter);
apiRouter.use("/town-hall", requireAuth, townHallRouter);
apiRouter.use("/elections", requireAuth, electionsRouter);
apiRouter.use("/positions", requireAuth, positionsRouter);
apiRouter.use("/profiles", requireAuth, profilesRouter);
apiRouter.use("/admin", requireAuth, adminRouter);

apiRouter.use((_req, res) => {
  res.status(404).json({ error: "No such endpoint." });
});
