import { Router } from "express";
import { z } from "zod";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { SUPPORT_KINDS, portalDevs, supportReplies, supportTickets, type SupportTicket } from "@shared/schema";
import { env } from "../env";
import { messageEmail, sendMail } from "../mailer";

/**
 * The Help button: questions and requests to the people who make Eagle Bot,
 * answered from the dev portal.
 *
 * Everyone sees only their own messages. Mounted outside the read-only guard,
 * since "why can't I edit anything?" is exactly what someone asks after a
 * demo ends.
 */
export const supportRouter = Router();

/** Tickets with their threads, oldest message first, and whether there's an answer they haven't seen. */
export async function withThreads(tickets: SupportTicket[]) {
  if (tickets.length === 0) return [];
  const replies = await db
    .select({
      id: supportReplies.id,
      ticketId: supportReplies.ticketId,
      userId: supportReplies.userId,
      devId: supportReplies.devId,
      devName: portalDevs.name,
      body: supportReplies.body,
      createdAt: supportReplies.createdAt,
    })
    .from(supportReplies)
    .leftJoin(portalDevs, eq(portalDevs.id, supportReplies.devId))
    .where(inArray(supportReplies.ticketId, tickets.map((ticket) => ticket.id)))
    .orderBy(asc(supportReplies.createdAt));
  return tickets.map((ticket) => {
    const thread = replies.filter((reply) => reply.ticketId === ticket.id);
    return {
      ...ticket,
      replies: thread.map(({ ticketId, devId, devName, ...reply }) => {
        void ticketId;
        return { ...reply, fromSupport: devId !== null, devName: devName ?? null };
      }),
      unread: thread.some((reply) => reply.devId !== null && reply.createdAt > ticket.userSeenAt),
    };
  });
}

supportRouter.get("/", async (req, res) => {
  const tickets = await db
    .select()
    .from(supportTickets)
    .where(and(eq(supportTickets.academyId, req.user!.academyId), eq(supportTickets.userId, req.user!.id)))
    .orderBy(desc(supportTickets.updatedAt))
    .limit(50);
  const threads = await withThreads(tickets);
  res.json({ tickets: threads, unread: threads.filter((ticket) => ticket.unread).length });
});

const ticketSchema = z.object({
  kind: z.enum(SUPPORT_KINDS),
  subject: z.string().trim().min(3, "Give it a short subject.").max(140),
  body: z.string().trim().min(3, "Say a bit more.").max(5000),
  page: z.string().max(300).optional(),
});

supportRouter.post("/", async (req, res) => {
  const parsed = ticketSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Check the form." });
  const user = req.user!;
  const academy = req.academy!;

  const [ticket] = await db
    .insert(supportTickets)
    .values({
      academyId: academy.id,
      userId: user.id,
      kind: parsed.data.kind,
      subject: parsed.data.subject,
      page: parsed.data.page ?? null,
    })
    .returning();
  await db.insert(supportReplies).values({ ticketId: ticket.id, userId: user.id, body: parsed.data.body });

  if (env.supportEmail) {
    const mail = messageEmail({
      academyName: academy.name,
      accent: academy.palette.primary,
      subject: `[Eagle Bot ${parsed.data.kind}] ${parsed.data.subject}`,
      heading: parsed.data.subject,
      paragraphs: [
        `${user.name} (${user.role}, ${user.email}) at ${academy.name}${parsed.data.page ? `, on ${parsed.data.page}` : ""}:`,
        parsed.data.body,
        "Answer it from the dev portal's Support tab.",
      ],
      link: `${env.appUrl}/dev-portal`,
      linkLabel: "Open the dev portal",
    });
    void sendMail({ to: env.supportEmail, ...mail });
  }

  res.status(201).json({ ok: true, id: ticket.id });
});

async function ownTicket(ticketId: number, userId: number) {
  const [ticket] = await db
    .select()
    .from(supportTickets)
    .where(and(eq(supportTickets.id, ticketId), eq(supportTickets.userId, userId)))
    .limit(1);
  return ticket ?? null;
}

supportRouter.post("/:id/replies", async (req, res) => {
  const parsed = z.object({ body: z.string().trim().min(1).max(5000) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Write something first." });
  const ticket = await ownTicket(Number(req.params.id), req.user!.id);
  if (!ticket) return res.status(404).json({ error: "That message isn't yours, or it's gone." });

  const now = new Date();
  await db.insert(supportReplies).values({ ticketId: ticket.id, userId: req.user!.id, body: parsed.data.body });
  // A follow-up puts it back in the portal's open pile, even if it had been closed.
  await db
    .update(supportTickets)
    .set({ status: "open", updatedAt: now, userSeenAt: now })
    .where(eq(supportTickets.id, ticket.id));
  res.status(201).json({ ok: true });
});

supportRouter.post("/:id/seen", async (req, res) => {
  const ticket = await ownTicket(Number(req.params.id), req.user!.id);
  if (!ticket) return res.status(404).json({ error: "That message isn't yours, or it's gone." });
  await db.update(supportTickets).set({ userSeenAt: new Date() }).where(eq(supportTickets.id, ticket.id));
  res.json({ ok: true });
});
