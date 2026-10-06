import type { Request, Response, Router } from "express";
import { z } from "zod";
import type { PartnersDef } from "../shared/definition";
import { requirePermission } from "../../../server/auth";
import type { Runtime } from "../../../server/tacons/runtime";
import { PartnersError } from "./partners";
import { certifyApAssignment, resetApCode, revokeApCertificate, saveApAssignment, saveApCategory, saveApCode, saveApProfile } from "./workspace";
import { validLocation as marketLocation, locationShape as marketLocationShape } from "../../../server/tacons/locations";

type Access = { ok: true; runtime: Runtime; def: PartnersDef } | { ok: false; error: string; status: number };
type Authorize = (req: Request, location: { page?: string; panel?: string; position?: string }, index: number) => Promise<Access>;
const target = marketLocationShape.extend({ index: z.number().int().min(0).max(200) });
const base = "/view/:installId/partners/:name";
export function registerPartnersWorkspaceRoutes(router: Router, authorize: Authorize) {
  function post(path: string, shape: z.ZodRawShape, action: (access: Extract<Access, {ok: true}>, body: any, req: Request) => Promise<unknown>) {
    const schema = target.extend(shape).refine(marketLocation, "Choose exactly one location.");
    router.post(`${base}${path}`, requirePermission("tacons.use"), async (req: Request, res: Response) => {
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Check the dates and required fields and try again." });
      try {
        const access = await authorize(req, parsed.data, parsed.data.index);
        if (!access.ok) return res.status(access.status).json({ error: access.error });
        return res.json(await action(access, parsed.data, req));
      } catch (error) {
        if (error instanceof PartnersError) return res.status(400).json({ error: error.message });
        console.error("[ap-workspace] operation failed", error instanceof Error ? error.name : "Unknown error");
        return res.status(500).json({ error: "That couldn't be saved. Please try again." });
      }
    });
  }
  post("/categories", { id: z.number().int().positive().optional(), name: z.string().min(1).max(60), archived: z.boolean().optional() },
    async (a, body) => saveApCategory(a.runtime, a.def, body));
  post("/assignments", {
    id: z.number().int().positive().optional(), week: z.string(), category: z.string().min(1).max(60),
    title: z.string().min(1).max(160), description: z.string().max(2000),
    dueDate: z.string(), archived: z.boolean(),
  }, async (a, body) => saveApAssignment(a.runtime, a.def, body));
  post("/profile", {
    attendanceDays: z.array(z.number().int().min(0).max(6)).max(7),
    absences: z.array(z.object({ date: z.string(), reason: z.enum(["sick", "other"]), notes: z.string().max(500) })).max(1000),
    milestones: z.array(z.object({ id: z.string().min(1).max(80), date: z.string(), title: z.string().min(1).max(160), notes: z.string().max(500) })).max(1000),
  }, async (a, body) => saveApProfile(a.runtime, a.def, body));
  post("/code", { code: z.string().regex(/^\d{6}$/), currentCode: z.string().regex(/^\d{6}$/).optional() },
    async (a, body) => { await saveApCode(a.runtime, a.def, body.code, body.currentCode); return { ok: true }; });
  post("/reset-code", { personId: z.number().int().positive() },
    async (a, body) => { await resetApCode(a.runtime, a.def, body.personId); return { ok: true }; });
  post("/certify", {
    assignmentId: z.number().int().positive(), targetId: z.number().int().positive(),
    completedDate: z.string(), excellence: z.boolean(), notes: z.string().max(2000),
    evidence: z.string().min(1).max(2000), code: z.string().max(20),
  }, async (a, body) => ({ certificate: await certifyApAssignment(a.runtime, a.def, body) }));
  post("/certificates/:id/revoke", {}, async (a, _body, req) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) throw new PartnersError("Choose a valid certificate.");
    return { certificate: await revokeApCertificate(a.runtime, a.def, id) };
  });
}
