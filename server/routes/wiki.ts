import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "../db";
import {
  aiFindings,
  documents,
  studios,
  users,
  wikiRevisions,
  wikiRules,
  wikiSections,
} from "@shared/schema";
import { requirePermission } from "../auth";
import { logActivity } from "../activity";
import { extractText, UnsupportedFileError, ACCEPTED_EXTENSIONS } from "../extract";
import { createJob, startBuildWiki } from "../ai/jobs";
import { applyOperations, revertJob, slugify } from "../ai/apply";
import { aiConfigured } from "../env";
import {
  canReadShared,
  canReadStudio,
  requireScope,
  scoped,
  scopedShared,
  studioFilter,
  StudioChoiceError,
  writeStudioId,
} from "../studio";

export const wikiRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 20 },
});

/** Turns a StudioChoiceError into a 400 the form can show, instead of a 500. */
function handleStudioError(error: unknown, res: import("express").Response): boolean {
  if (error instanceof StudioChoiceError) {
    res.status(400).json({ error: error.message, needsStudio: true });
    return true;
  }
  return false;
}

/* --------------------------------- read ---------------------------------- */

/**
 * The wiki for the studio being viewed, plus anything the academy holds in
 * common. Sections carry the studio; rules inherit it from their section, so
 * a rule can never drift away from the studio whose Contract it is part of.
 */
wikiRouter.get("/", requirePermission("wiki.read"), async (req, res) => {
  const academyId = req.user!.academyId;
  const scope = requireScope(req);
  const includeRepealed = req.query.includeRepealed === "true";

  const sections = await db
    .select()
    .from(wikiSections)
    .where(
      scopedShared(
        eq(wikiSections.academyId, academyId),
        wikiSections.studioId,
        wikiSections.sharedStudioIds,
        scope,
      ),
    )
    .orderBy(asc(wikiSections.orderIndex), asc(wikiSections.id));

  const sectionIds = sections.map((section) => section.id);
  const rules = sectionIds.length
    ? await db
        .select()
        .from(wikiRules)
        .where(
          includeRepealed
            ? inArray(wikiRules.sectionId, sectionIds)
            : and(inArray(wikiRules.sectionId, sectionIds), ne(wikiRules.status, "repealed")),
        )
        .orderBy(asc(wikiRules.orderIndex), asc(wikiRules.id))
    : [];

  const studioNames = new Map(
    (await db.select().from(studios).where(eq(studios.academyId, academyId))).map((studio) => [
      studio.id,
      { name: studio.name, color: studio.color },
    ]),
  );

  res.json({
    sections: sections.map((section) => ({
      ...section,
      studioName: section.studioId ? (studioNames.get(section.studioId)?.name ?? null) : null,
      studioColor: section.studioId ? (studioNames.get(section.studioId)?.color ?? null) : null,
      shared: section.studioId === null,
      /** Named so the UI can say "shared with Launchpad" rather than just "shared". */
      sharedWith: (section.sharedStudioIds ?? [])
        .map((id) => studioNames.get(id)?.name)
        .filter((name): name is string => Boolean(name)),
      rules: rules.filter((rule) => rule.sectionId === section.id),
    })),
    counts: {
      active: rules.filter((r) => r.status === "active").length,
      repealed: rules.filter((r) => r.status === "repealed").length,
      shared: sections.filter((section) => section.studioId === null).length,
    },
  });
});

wikiRouter.get("/rules/:id/history", requirePermission("wiki.read"), async (req, res) => {
  const id = Number(req.params.id);
  const revisions = await db
    .select({
      revision: wikiRevisions,
      actorName: users.name,
    })
    .from(wikiRevisions)
    .leftJoin(users, eq(users.id, wikiRevisions.actorUserId))
    .where(and(eq(wikiRevisions.ruleId, id), eq(wikiRevisions.academyId, req.user!.academyId)))
    .orderBy(desc(wikiRevisions.id));
  res.json({ revisions });
});

/** Loads a rule and refuses it if it belongs to a studio the caller can't see. */
async function readableRule(req: import("express").Request, ruleId: number) {
  const rows = await db
    .select({
      rule: wikiRules,
      studioId: wikiSections.studioId,
      sharedStudioIds: wikiSections.sharedStudioIds,
    })
    .from(wikiRules)
    .innerJoin(wikiSections, eq(wikiSections.id, wikiRules.sectionId))
    .where(and(eq(wikiRules.id, ruleId), eq(wikiRules.academyId, req.user!.academyId)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (!canReadShared(requireScope(req), row.studioId, row.sharedStudioIds)) return null;
  return row;
}

/* -------------------------------- editing -------------------------------- */

wikiRouter.post("/sections", requirePermission("wiki.edit"), async (req, res) => {
  const parsed = z
    .object({
      title: z.string().min(2).max(120),
      summary: z.string().max(500).optional(),
      /** Omit to use the studio being viewed; null files it academy-wide. */
      studioId: z.number().int().nullable().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Give the section a title." });

  const academyId = req.user!.academyId;
  const scope = requireScope(req);

  let studioId: number | null;
  try {
    studioId = writeStudioId(scope, parsed.data.studioId);
  } catch (error) {
    if (handleStudioError(error, res)) return;
    throw error;
  }

  const [{ max }] = await db
    .select({ max: sql<number>`coalesce(max(${wikiSections.orderIndex}), -1)` })
    .from(wikiSections)
    .where(eq(wikiSections.academyId, academyId));

  const [section] = await db
    .insert(wikiSections)
    .values({
      academyId,
      studioId,
      title: parsed.data.title,
      slug: slugify(parsed.data.title) + "-" + Date.now().toString(36).slice(-4),
      summary: parsed.data.summary ?? null,
      orderIndex: (max ?? -1) + 1,
    })
    .returning();

  await logActivity({
    academyId,
    studioId,
    actorUserId: req.user!.id,
    action: "wiki.section.created",
    entityType: "wiki_section",
    entityId: section.id,
    summary: `${req.user!.name} added the section "${section.title}".`,
  });

  res.status(201).json({ section });
});

/**
 * Moves a section between studios, or shares it into others.
 *
 * Sharing is how two studios keep one space in common - Middle and Launchpad
 * running the same Hero Bucks system - without it landing in Spark and without
 * two copies drifting apart.
 */
wikiRouter.patch("/sections/:id", requirePermission("wiki.edit"), async (req, res) => {
  const parsed = z
    .object({
      title: z.string().min(2).max(120).optional(),
      summary: z.string().max(500).nullable().optional(),
      studioId: z.number().int().nullable().optional(),
      sharedStudioIds: z.array(z.number().int()).max(20).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Couldn't save that." });

  const scope = requireScope(req);
  const id = Number(req.params.id);

  const [before] = await db
    .select()
    .from(wikiSections)
    .where(and(eq(wikiSections.id, id), eq(wikiSections.academyId, req.user!.academyId)))
    .limit(1);
  if (!before || !canReadStudio(scope, before.studioId)) {
    return res.status(404).json({ error: "That section doesn't exist." });
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.title !== undefined) patch.title = parsed.data.title;
  if (parsed.data.summary !== undefined) patch.summary = parsed.data.summary;
  if (parsed.data.studioId !== undefined) {
    if (parsed.data.studioId !== null && !scope.allowedIds.includes(parsed.data.studioId)) {
      return res.status(403).json({ error: "That isn't a studio you can move this into." });
    }
    if (parsed.data.studioId === null && !scope.canWriteShared) {
      return res.status(403).json({ error: "Only an admin can make a section academy-wide." });
    }
    patch.studioId = parsed.data.studioId;
  }
  if (parsed.data.sharedStudioIds !== undefined) {
    // Sharing hands another studio's learners a rule they didn't vote on, so
    // only someone who can see the whole academy gets to arrange it.
    if (!scope.canWriteShared) {
      return res.status(403).json({ error: "Only an admin can share a section between studios." });
    }
    const owner = (patch.studioId as number | null | undefined) ?? before.studioId;
    const unknown = parsed.data.sharedStudioIds.filter((sid) => !scope.allowedIds.includes(sid));
    if (unknown.length > 0) {
      return res.status(400).json({ error: "One of those studios doesn't exist." });
    }
    patch.sharedStudioIds = [...new Set(parsed.data.sharedStudioIds)].filter((sid) => sid !== owner);
  }

  const [section] = await db.update(wikiSections).set(patch).where(eq(wikiSections.id, id)).returning();

  const sharingChanged =
    parsed.data.sharedStudioIds !== undefined &&
    JSON.stringify(section.sharedStudioIds) !== JSON.stringify(before.sharedStudioIds ?? []);

  await logActivity({
    academyId: req.user!.academyId,
    studioId: section.studioId,
    actorUserId: req.user!.id,
    action: "wiki.section.updated",
    entityType: "wiki_section",
    entityId: section.id,
    summary: sharingChanged
      ? `${req.user!.name} changed which studios share "${section.title}".`
      : parsed.data.studioId !== undefined && parsed.data.studioId !== before.studioId
        ? `${req.user!.name} moved "${section.title}" to a different studio.`
        : `${req.user!.name} updated the section "${section.title}".`,
    metadata: { sharedStudioIds: section.sharedStudioIds },
  });

  res.json({ section });
});

wikiRouter.post("/rules", requirePermission("wiki.edit"), async (req, res) => {
  const parsed = z
    .object({
      sectionId: z.number().int(),
      title: z.string().min(2).max(200),
      body: z.string().min(1),
      rationale: z.string().max(500).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "A rule needs a title and a body." });

  const academyId = req.user!.academyId;
  const scope = requireScope(req);

  const [section] = await db
    .select()
    .from(wikiSections)
    .where(and(eq(wikiSections.id, parsed.data.sectionId), eq(wikiSections.academyId, academyId)))
    .limit(1);
  if (!section || !canReadShared(scope, section.studioId, section.sharedStudioIds)) {
    return res.status(404).json({ error: "That section doesn't exist." });
  }

  const outcome = await applyOperations({
    academyId,
    operations: [
      {
        op: "create_rule",
        sectionKey: section.slug,
        title: parsed.data.title,
        body: parsed.data.body,
        rationale: parsed.data.rationale || `Added by ${req.user!.name}.`,
      },
    ],
    actorUserId: req.user!.id,
    actorType: "user",
    sourceType: "manual",
    sourceRef: null,
    jobId: null,
    studioId: section.studioId,
  });

  await logActivity({
    academyId,
    studioId: section.studioId,
    actorUserId: req.user!.id,
    action: "wiki.rule.created",
    entityType: "wiki_rule",
    entityId: outcome.ruleIdsTouched[0] ?? null,
    summary: `${req.user!.name} added the rule "${parsed.data.title}".`,
  });

  res.status(201).json({ ok: true, ruleId: outcome.ruleIdsTouched[0] });
});

wikiRouter.patch("/rules/:id", requirePermission("wiki.edit"), async (req, res) => {
  const parsed = z
    .object({
      title: z.string().min(2).max(200),
      body: z.string().min(1),
      rationale: z.string().max(500).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "A rule needs a title and a body." });

  // The history is the product. An academy can insist every edit explains itself.
  if (req.settings!.governance.requireRationaleOnEdits && !parsed.data.rationale?.trim()) {
    return res.status(400).json({
      error:
        "This academy asks for a reason on every wiki edit. Say what changed and why - someone will read it in a year.",
      field: "rationale",
    });
  }

  const id = Number(req.params.id);
  const existing = await readableRule(req, id);
  if (!existing) return res.status(404).json({ error: "That rule doesn't exist." });

  const outcome = await applyOperations({
    academyId: req.user!.academyId,
    operations: [
      {
        op: "amend_rule",
        ruleId: id,
        title: parsed.data.title,
        body: parsed.data.body,
        rationale: parsed.data.rationale || `Edited by ${req.user!.name}.`,
      },
    ],
    actorUserId: req.user!.id,
    actorType: "user",
    sourceType: "manual",
    sourceRef: null,
    jobId: null,
    studioId: existing.studioId,
  });

  if (outcome.amended === 0) return res.status(404).json({ error: "That rule doesn't exist." });

  await logActivity({
    academyId: req.user!.academyId,
    studioId: existing.studioId,
    actorUserId: req.user!.id,
    action: "wiki.rule.amended",
    entityType: "wiki_rule",
    entityId: id,
    summary: `${req.user!.name} edited "${parsed.data.title}".`,
  });

  res.json({ ok: true });
});

wikiRouter.post("/rules/:id/repeal", requirePermission("wiki.edit"), async (req, res) => {
  const id = Number(req.params.id);
  const rationale = z.string().max(500).optional().parse(req.body?.rationale);

  if (req.settings!.governance.requireRationaleOnEdits && !rationale?.trim()) {
    return res.status(400).json({
      error: "This academy asks for a reason on every wiki change, repeals included.",
      field: "rationale",
    });
  }

  const existing = await readableRule(req, id);
  if (!existing) return res.status(404).json({ error: "That rule doesn't exist." });

  const outcome = await applyOperations({
    academyId: req.user!.academyId,
    operations: [
      { op: "repeal_rule", ruleId: id, rationale: rationale || `Repealed by ${req.user!.name}.` },
    ],
    actorUserId: req.user!.id,
    actorType: "user",
    sourceType: "manual",
    sourceRef: null,
    jobId: null,
    studioId: existing.studioId,
  });

  if (outcome.repealed === 0) {
    return res.status(404).json({ error: "That rule doesn't exist or is already repealed." });
  }

  await logActivity({
    academyId: req.user!.academyId,
    studioId: existing.studioId,
    actorUserId: req.user!.id,
    action: "wiki.rule.repealed",
    entityType: "wiki_rule",
    entityId: id,
    summary: `${req.user!.name} repealed a rule.`,
  });

  res.json({ ok: true });
});

/* ------------------------------- documents -------------------------------- */

wikiRouter.get("/documents", requirePermission("wiki.read"), async (req, res) => {
  const scope = requireScope(req);
  const rows = await db
    .select({
      id: documents.id,
      filename: documents.filename,
      sizeBytes: documents.sizeBytes,
      status: documents.status,
      studioId: documents.studioId,
      createdAt: documents.createdAt,
      uploaderName: users.name,
      characters: sql<number>`length(${documents.content})`,
    })
    .from(documents)
    .leftJoin(users, eq(users.id, documents.uploadedBy))
    .where(scoped(eq(documents.academyId, req.user!.academyId), documents.studioId, scope))
    .orderBy(desc(documents.id));
  res.json({ documents: rows, acceptedExtensions: ACCEPTED_EXTENSIONS });
});

wikiRouter.post(
  "/documents",
  requirePermission("documents.upload"),
  upload.array("files", 20),
  async (req, res) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) return res.status(400).json({ error: "No files came through." });

    const scope = requireScope(req);
    // An upload with no studio selected is academy-wide, which an admin can do
    // and anyone else cannot - the form makes them choose.
    let studioId: number | null;
    try {
      const raw = req.body?.studioId;
      const explicit =
        raw === undefined || raw === "" ? undefined : raw === "null" ? null : Number(raw);
      studioId = writeStudioId(scope, explicit as number | null | undefined);
    } catch (error) {
      if (handleStudioError(error, res)) return;
      throw error;
    }

    const saved: string[] = [];
    const failed: { filename: string; reason: string }[] = [];

    for (const file of files) {
      try {
        const content = await extractText(file.originalname, file.buffer);
        if (!content.trim()) {
          failed.push({ filename: file.originalname, reason: "The file had no readable text in it." });
          continue;
        }
        await db.insert(documents).values({
          academyId: req.user!.academyId,
          studioId,
          filename: file.originalname,
          mimeType: file.mimetype,
          sizeBytes: file.size,
          content,
          uploadedBy: req.user!.id,
          status: "pending",
        });
        saved.push(file.originalname);
      } catch (error) {
        failed.push({
          filename: file.originalname,
          reason:
            error instanceof UnsupportedFileError
              ? error.message
              : `Couldn't read it: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }

    if (saved.length > 0) {
      await logActivity({
        academyId: req.user!.academyId,
        studioId,
        actorUserId: req.user!.id,
        action: "document.uploaded",
        summary: `${req.user!.name} uploaded ${saved.length} document${saved.length === 1 ? "" : "s"}: ${saved.join(", ")}.`,
        metadata: { files: saved },
      });
    }

    res.status(saved.length > 0 ? 201 : 400).json({ saved, failed });
  },
);

wikiRouter.delete("/documents/:id", requirePermission("documents.upload"), async (req, res) => {
  const scope = requireScope(req);
  const [doc] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, Number(req.params.id)), eq(documents.academyId, req.user!.academyId)))
    .limit(1);
  if (!doc || !canReadStudio(scope, doc.studioId)) {
    return res.status(404).json({ error: "That document doesn't exist." });
  }
  await db.delete(documents).where(eq(documents.id, doc.id));
  res.json({ ok: true });
});

/* --------------------------------- AI ------------------------------------- */

/**
 * Builds one studio's wiki.
 *
 * Scoping the build matters as much as scoping the read: handing Claude every
 * studio's documents at once produces one merged Contract, which is precisely
 * the mess this tool exists to undo.
 */
wikiRouter.post("/build", requirePermission("wiki.ai_build"), async (req, res) => {
  if (!aiConfigured) {
    return res.status(503).json({ error: "The Claude API key isn't set, so AI features are off." });
  }
  if (!req.settings!.ai.enabled) {
    return res.status(403).json({ error: "AI features are switched off in this academy's settings." });
  }

  const academyId = req.user!.academyId;
  const scope = requireScope(req);

  let studioId: number | null;
  try {
    studioId = writeStudioId(scope, req.body?.studioId);
  } catch (error) {
    if (handleStudioError(error, res)) return;
    throw error;
  }

  // The build reads this studio's documents plus any academy-wide ones.
  const filter = studioFilter(documents.studioId, {
    ...scope,
    studioId,
    canSeeAll: studioId === null && scope.canSeeAll,
  });
  const [pending] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(documents)
    .where(filter ? and(eq(documents.academyId, academyId), filter) : eq(documents.academyId, academyId));

  if ((pending?.count ?? 0) === 0) {
    return res.status(400).json({
      error: studioId
        ? "There are no documents for this studio yet. Upload some first."
        : "Upload at least one document first.",
    });
  }

  const job = await createJob({
    academyId,
    studioId,
    kind: "build_wiki",
    requestedBy: req.user!.id,
    message: "Queued",
  });
  startBuildWiki(job);

  await logActivity({
    academyId,
    studioId,
    actorUserId: req.user!.id,
    action: "wiki.build.requested",
    entityType: "ai_job",
    entityId: job.id,
    summary: `${req.user!.name} asked the AI to build the wiki from the uploaded documents.`,
  });

  res.status(202).json({ jobId: job.id });
});

wikiRouter.post("/jobs/:id/revert", requirePermission("wiki.edit"), async (req, res) => {
  const jobId = Number(req.params.id);
  const reason = (req.body?.reason as string | undefined) || `Reverted by ${req.user!.name}.`;

  const result = await revertJob({
    academyId: req.user!.academyId,
    jobId,
    actorUserId: req.user!.id,
    reason,
  });

  await logActivity({
    academyId: req.user!.academyId,
    studioId: requireScope(req).studioId,
    actorUserId: req.user!.id,
    action: "wiki.job.reverted",
    entityType: "ai_job",
    entityId: jobId,
    summary: `${req.user!.name} reverted ${result.reverted} change${result.reverted === 1 ? "" : "s"} made by an AI run.`,
  });

  res.json(result);
});

/* ------------------------------- findings --------------------------------- */

wikiRouter.get("/findings", requirePermission("wiki.read"), async (req, res) => {
  const status = (req.query.status as string) || "open";
  const scope = requireScope(req);
  const base =
    status === "all"
      ? eq(aiFindings.academyId, req.user!.academyId)
      : and(eq(aiFindings.academyId, req.user!.academyId), eq(aiFindings.status, status));

  const rows = await db
    .select()
    .from(aiFindings)
    .where(scoped(base, aiFindings.studioId, scope))
    .orderBy(desc(aiFindings.severity), desc(aiFindings.id));
  res.json({ findings: rows });
});

wikiRouter.post("/findings/:id/resolve", requirePermission("findings.resolve"), async (req, res) => {
  const parsed = z
    .object({
      status: z.enum(["resolved", "dismissed"]),
      note: z.string().max(1000).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Say whether it's resolved or dismissed." });

  const scope = requireScope(req);
  const [target] = await db
    .select()
    .from(aiFindings)
    .where(and(eq(aiFindings.id, Number(req.params.id)), eq(aiFindings.academyId, req.user!.academyId)))
    .limit(1);
  if (!target || !canReadStudio(scope, target.studioId)) {
    return res.status(404).json({ error: "That finding doesn't exist." });
  }

  const [finding] = await db
    .update(aiFindings)
    .set({
      status: parsed.data.status,
      resolutionNote: parsed.data.note ?? null,
      resolvedBy: req.user!.id,
      resolvedAt: new Date(),
    })
    .where(eq(aiFindings.id, target.id))
    .returning();

  await logActivity({
    academyId: req.user!.academyId,
    studioId: finding.studioId,
    actorUserId: req.user!.id,
    action: `finding.${parsed.data.status}`,
    entityType: "ai_finding",
    entityId: finding.id,
    summary: `${req.user!.name} marked "${finding.title}" as ${parsed.data.status}.`,
    metadata: { note: parsed.data.note },
  });

  res.json({ finding });
});
