import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { db } from "../db";
import {
  aiFindings,
  documents,
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

export const wikiRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 20 },
});

/* --------------------------------- read ---------------------------------- */

wikiRouter.get("/", requirePermission("wiki.read"), async (req, res) => {
  const academyId = req.user!.academyId;
  const includeRepealed = req.query.includeRepealed === "true";

  const sections = await db
    .select()
    .from(wikiSections)
    .where(eq(wikiSections.academyId, academyId))
    .orderBy(asc(wikiSections.orderIndex), asc(wikiSections.id));

  const rules = await db
    .select()
    .from(wikiRules)
    .where(
      includeRepealed
        ? eq(wikiRules.academyId, academyId)
        : and(eq(wikiRules.academyId, academyId), ne(wikiRules.status, "repealed")),
    )
    .orderBy(asc(wikiRules.orderIndex), asc(wikiRules.id));

  res.json({
    sections: sections.map((section) => ({
      ...section,
      rules: rules.filter((rule) => rule.sectionId === section.id),
    })),
    counts: {
      active: rules.filter((r) => r.status === "active").length,
      repealed: rules.filter((r) => r.status === "repealed").length,
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

/* -------------------------------- editing -------------------------------- */

wikiRouter.post("/sections", requirePermission("wiki.edit"), async (req, res) => {
  const parsed = z
    .object({ title: z.string().min(2).max(120), summary: z.string().max(500).optional() })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Give the section a title." });

  const academyId = req.user!.academyId;
  const [{ max }] = await db
    .select({ max: sql<number>`coalesce(max(${wikiSections.orderIndex}), -1)` })
    .from(wikiSections)
    .where(eq(wikiSections.academyId, academyId));

  const [section] = await db
    .insert(wikiSections)
    .values({
      academyId,
      title: parsed.data.title,
      slug: slugify(parsed.data.title) + "-" + Date.now().toString(36).slice(-4),
      summary: parsed.data.summary ?? null,
      orderIndex: (max ?? -1) + 1,
    })
    .returning();

  await logActivity({
    academyId,
    actorUserId: req.user!.id,
    action: "wiki.section.created",
    entityType: "wiki_section",
    entityId: section.id,
    summary: `${req.user!.name} added the section "${section.title}".`,
  });

  res.status(201).json({ section });
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
  const [section] = await db
    .select()
    .from(wikiSections)
    .where(and(eq(wikiSections.id, parsed.data.sectionId), eq(wikiSections.academyId, academyId)))
    .limit(1);
  if (!section) return res.status(404).json({ error: "That section doesn't exist." });

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
  });

  await logActivity({
    academyId,
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

  const id = Number(req.params.id);
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
  });

  if (outcome.amended === 0) return res.status(404).json({ error: "That rule doesn't exist." });

  await logActivity({
    academyId: req.user!.academyId,
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
  });

  if (outcome.repealed === 0) {
    return res.status(404).json({ error: "That rule doesn't exist or is already repealed." });
  }

  await logActivity({
    academyId: req.user!.academyId,
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
  const rows = await db
    .select({
      id: documents.id,
      filename: documents.filename,
      sizeBytes: documents.sizeBytes,
      status: documents.status,
      createdAt: documents.createdAt,
      uploaderName: users.name,
      characters: sql<number>`length(${documents.content})`,
    })
    .from(documents)
    .leftJoin(users, eq(users.id, documents.uploadedBy))
    .where(eq(documents.academyId, req.user!.academyId))
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
  await db
    .delete(documents)
    .where(and(eq(documents.id, Number(req.params.id)), eq(documents.academyId, req.user!.academyId)));
  res.json({ ok: true });
});

/* --------------------------------- AI ------------------------------------- */

wikiRouter.post("/build", requirePermission("wiki.ai_build"), async (req, res) => {
  if (!aiConfigured) {
    return res.status(503).json({ error: "The Claude API key isn't set, so AI features are off." });
  }
  const academyId = req.user!.academyId;

  const pending = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(documents)
    .where(eq(documents.academyId, academyId));
  if ((pending[0]?.count ?? 0) === 0) {
    return res.status(400).json({ error: "Upload at least one document first." });
  }

  const job = await createJob({
    academyId,
    kind: "build_wiki",
    requestedBy: req.user!.id,
    message: "Queued",
  });
  startBuildWiki(job);

  await logActivity({
    academyId,
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
  const rows = await db
    .select()
    .from(aiFindings)
    .where(
      status === "all"
        ? eq(aiFindings.academyId, req.user!.academyId)
        : and(eq(aiFindings.academyId, req.user!.academyId), eq(aiFindings.status, status)),
    )
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

  const [finding] = await db
    .update(aiFindings)
    .set({
      status: parsed.data.status,
      resolutionNote: parsed.data.note ?? null,
      resolvedBy: req.user!.id,
      resolvedAt: new Date(),
    })
    .where(and(eq(aiFindings.id, Number(req.params.id)), eq(aiFindings.academyId, req.user!.academyId)))
    .returning();

  if (!finding) return res.status(404).json({ error: "That finding doesn't exist." });

  await logActivity({
    academyId: req.user!.academyId,
    actorUserId: req.user!.id,
    action: `finding.${parsed.data.status}`,
    entityType: "ai_finding",
    entityId: finding.id,
    summary: `${req.user!.name} marked "${finding.title}" as ${parsed.data.status}.`,
    metadata: { note: parsed.data.note },
  });

  res.json({ finding });
});
