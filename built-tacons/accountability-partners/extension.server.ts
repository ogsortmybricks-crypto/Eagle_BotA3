import { Router } from "express";
import type { TaconServerExtension } from "../../server/tacons/extensions";
import { EXTENSION_ID, partnerWidget } from "./shared/definition";
import { renderPartners } from "./server/partners";
import { taconPartnersRouter } from "./server/routes";
import { readPublicApCertificate } from "./server/workspace";

const publicRoutes = Router();
publicRoutes.get("/ap/verify/:token", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  try {
    const certificate = await readPublicApCertificate(req.params.token);
    if (!certificate) return res.status(404).json({ error: "That certification isn't available." });
    return res.json(certificate);
  } catch { return res.status(500).json({ error: "Couldn't verify this record. Please try again." }); }
});

const extension: TaconServerExtension = {
  id: EXTENSION_ID,
  legacyWidgetKinds: ["partners"],
  routes: taconPartnersRouter,
  publicRoutes,
  async render(runtime, configuration, index) {
    const widget = partnerWidget(configuration);
    if (!widget) throw new Error("Invalid AP widget configuration.");
    return renderPartners(runtime, widget, index);
  },
};
export default extension;
