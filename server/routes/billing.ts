import { Router, type Response } from "express";
import { z } from "zod";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db";
import {
  academies,
  demoSurveys,
  positionHolders,
  positions,
  studios,
  users,
  wikiRules,
  wikiSections,
} from "@shared/schema";
import { PLAN_LABELS, type BillingStatus } from "@shared/plans";
import { requirePermission } from "../auth";
import { logActivity } from "../activity";
import { env, stripeConfigured } from "../env";
import { messageEmail, sendMail } from "../mailer";
import {
  StripeError,
  accessFor,
  demoDaysLeft,
  forgetFoundingSpots,
  foundingSpotsLeft,
  planForPrice,
  planPrices,
  refreshSubscription,
  stripe,
  surveyOpen,
} from "../billing";

/**
 * The free demo, the end-of-demo survey, and paying for a plan.
 *
 * Mounted outside the read-only guard on purpose: an academy whose demo has
 * ended still has to be able to answer the survey, pay, and take its wiki
 * with it.
 */
export const billingRouter = Router();

billingRouter.get("/", async (req, res) => {
  const academy = await refreshSubscription(req.academy!);
  const user = req.user!;
  const isAdmin = user.role === "admin";

  const [mine] = await db
    .select()
    .from(demoSurveys)
    .where(and(eq(demoSurveys.academyId, academy.id), eq(demoSurveys.userId, user.id)))
    .limit(1);

  // Stripe being slow or down shouldn't break the page - the admin just sees
  // that prices couldn't be loaded.
  let foundingSpots: number | null = null;
  let prices: BillingStatus["prices"] = null;
  if (isAdmin && stripeConfigured) {
    try {
      [foundingSpots, prices] = await Promise.all([foundingSpotsLeft(), planPrices()]);
    } catch (error) {
      console.error("[billing] couldn't load plans from Stripe", error);
    }
  }

  const status: BillingStatus = {
    access: accessFor(academy),
    plan: academy.plan as BillingStatus["plan"],
    demoEndsAt: academy.demoEndsAt.toISOString(),
    daysLeft: demoDaysLeft(academy),
    surveyOpen: surveyOpen(academy),
    isAdmin,
    stripeConfigured,
    subscriptionStatus: academy.subscriptionStatus,
    myResponse: mine
      ? {
          rating: mine.rating,
          liked: mine.liked,
          improve: mine.improve,
          continueChoice: mine.continueChoice as "yes" | "no" | "unsure" | null,
        }
      : null,
    foundingSpotsLeft: isAdmin ? foundingSpots : null,
    offer: isAdmin && foundingSpots !== null ? (foundingSpots > 0 ? "founding" : "academy") : null,
    prices: isAdmin ? prices : null,
  };
  res.json(status);
});

/* -------------------------------------------------------------------------- */
/*  Survey                                                                     */
/* -------------------------------------------------------------------------- */

const surveySchema = z.object({
  rating: z.number().int().min(1).max(5),
  liked: z.string().max(2000).optional(),
  improve: z.string().max(2000).optional(),
  continueChoice: z.enum(["yes", "no", "unsure"]).optional(),
});

billingRouter.put("/survey", async (req, res) => {
  const parsed = surveySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Pick a rating from 1 to 5." });
  const user = req.user!;
  const academy = req.academy!;
  // Whether to keep paying is an admin's call; everyone else's answer is feedback.
  const continueChoice = user.role === "admin" ? (parsed.data.continueChoice ?? null) : null;
  const values = {
    rating: parsed.data.rating,
    liked: parsed.data.liked?.trim() || null,
    improve: parsed.data.improve?.trim() || null,
    continueChoice,
  };

  await db
    .insert(demoSurveys)
    .values({ academyId: academy.id, userId: user.id, ...values })
    .onConflictDoUpdate({
      target: [demoSurveys.academyId, demoSurveys.userId],
      set: { ...values, updatedAt: new Date() },
    });

  await logActivity({
    academyId: academy.id,
    studioId: user.studioId,
    actorUserId: user.id,
    action: "demo.survey",
    entityType: "academy",
    entityId: academy.id,
    summary: `${user.name} answered the demo survey${continueChoice ? ` (keep using Eagle Bot: ${continueChoice})` : ""}.`,
  });

  if (env.supportEmail) {
    const mail = messageEmail({
      academyName: academy.name,
      accent: academy.palette.primary,
      subject: `Demo survey: ${academy.name} - ${values.rating}/5`,
      heading: `${user.name} (${user.role}) rated Eagle Bot ${values.rating}/5`,
      paragraphs: [
        ...(continueChoice ? [`Keep using it: ${continueChoice}`] : []),
        `Liked: ${values.liked ?? "-"}`,
        `Would improve: ${values.improve ?? "-"}`,
      ],
    });
    void sendMail({ to: env.supportEmail, ...mail });
  }

  res.json({ ok: true });
});

/* -------------------------------------------------------------------------- */
/*  Paying                                                                     */
/* -------------------------------------------------------------------------- */

type CheckoutSession = {
  id: string;
  url: string | null;
  status: string;
  client_reference_id: string | null;
  customer: string | null;
  subscription: { id: string; status: string; items: { data: { price: { id: string } }[] } } | null;
  metadata: Record<string, string>;
};

function sendStripeError(res: Response, error: unknown) {
  if (error instanceof StripeError) return res.status(502).json({ error: error.message });
  throw error;
}

billingRouter.post("/checkout", requirePermission("academy.manage"), async (req, res) => {
  const parsed = z.object({ interval: z.enum(["month", "year"]) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Pick monthly or yearly." });
  if (!stripeConfigured) return res.status(503).json({ error: "Payments aren't set up on this Eagle Bot yet." });

  const academy = await refreshSubscription(req.academy!, true);
  if (accessFor(academy) === "paid") {
    return res.status(409).json({ error: "This academy already has a plan. Use Manage billing to change it." });
  }

  try {
    forgetFoundingSpots();
    const spots = await foundingSpotsLeft();
    const plan = spots && spots > 0 ? "founding" : "academy";
    const price = env.stripe.prices[plan][parsed.data.interval];
    const back = `${env.appUrl}/plan`;
    const session = await stripe<CheckoutSession>("POST", "/checkout/sessions", {
      mode: "subscription",
      line_items: [{ price, quantity: 1 }],
      client_reference_id: String(academy.id),
      ...(academy.stripeCustomerId
        ? { customer: academy.stripeCustomerId }
        : { customer_email: req.user!.email }),
      metadata: { academy_id: academy.id, academy_name: academy.name, app_url: env.appUrl, plan },
      subscription_data: {
        metadata: { academy_id: academy.id, academy_name: academy.name, app_url: env.appUrl, plan },
      },
      success_url: `${back}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${back}?checkout=cancelled`,
    });
    res.json({ url: session.url, plan });
  } catch (error) {
    sendStripeError(res, error);
  }
});

/** Called when the admin lands back from Stripe. Stripe, not the browser, says whether it worked. */
billingRouter.post("/confirm", requirePermission("academy.manage"), async (req, res) => {
  const parsed = z.object({ sessionId: z.string().min(5).max(200) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "That checkout link is incomplete." });
  const academy = req.academy!;
  const user = req.user!;

  try {
    const session = await stripe<CheckoutSession>("GET", `/checkout/sessions/${parsed.data.sessionId}`, {
      expand: ["subscription"],
    });
    if (session.client_reference_id !== String(academy.id) || session.metadata.app_url !== env.appUrl) {
      return res.status(403).json({ error: "That checkout belongs to a different academy." });
    }
    if (session.status !== "complete" || !session.subscription) {
      return res.status(409).json({ error: "Stripe hasn't finished that checkout. Try again in a minute." });
    }
    const plan = planForPrice(session.subscription.items.data[0]?.price.id ?? "") ?? "academy";
    await db
      .update(academies)
      .set({
        plan,
        stripeCustomerId: session.customer,
        stripeSubscriptionId: session.subscription.id,
        subscriptionStatus: session.subscription.status,
        subscriptionCheckedAt: new Date(),
      })
      .where(eq(academies.id, academy.id));
    forgetFoundingSpots();

    // A refresh of the success page confirms again; only log the first time.
    if (academy.stripeSubscriptionId !== session.subscription.id) {
      await logActivity({
        academyId: academy.id,
        actorUserId: user.id,
        action: "billing.subscribed",
        entityType: "academy",
        entityId: academy.id,
        summary: `${user.name} moved ${academy.name} onto the ${PLAN_LABELS[plan]} plan.`,
      });
      if (env.supportEmail) {
        const mail = messageEmail({
          academyName: academy.name,
          accent: academy.palette.primary,
          subject: `New subscription: ${academy.name} (${PLAN_LABELS[plan]})`,
          heading: `${academy.name} subscribed`,
          paragraphs: [`${user.name} (${user.email}) picked the ${PLAN_LABELS[plan]} plan.`],
        });
        void sendMail({ to: env.supportEmail, ...mail });
      }
    }
    res.json({ ok: true, plan });
  } catch (error) {
    sendStripeError(res, error);
  }
});

/** Stripe's own page for changing card, switching monthly/yearly, or cancelling. */
billingRouter.post("/manage", requirePermission("academy.manage"), async (req, res) => {
  const academy = req.academy!;
  if (!academy.stripeCustomerId) return res.status(409).json({ error: "This academy hasn't paid for a plan yet." });
  try {
    const session = await stripe<{ url: string }>("POST", "/billing_portal/sessions", {
      customer: academy.stripeCustomerId,
      return_url: `${env.appUrl}/plan`,
    });
    // Whatever they change there, read it fresh next time.
    await db.update(academies).set({ subscriptionCheckedAt: null }).where(eq(academies.id, academy.id));
    res.json({ url: session.url });
  } catch (error) {
    sendStripeError(res, error);
  }
});

/* -------------------------------------------------------------------------- */
/*  Export                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The whole academy's wiki and positions as one Markdown file. Works in every
 * state, read-only included - the rules belong to the studios, not to us.
 */
billingRouter.get("/export", requirePermission("academy.manage"), async (req, res) => {
  const academy = req.academy!;
  const [studioRows, sectionRows, ruleRows, positionRows, holderRows] = await Promise.all([
    db.select().from(studios).where(eq(studios.academyId, academy.id)).orderBy(asc(studios.orderIndex)),
    db
      .select()
      .from(wikiSections)
      .where(eq(wikiSections.academyId, academy.id))
      .orderBy(asc(wikiSections.orderIndex)),
    db
      .select()
      .from(wikiRules)
      .where(and(eq(wikiRules.academyId, academy.id), inArray(wikiRules.status, ["active", "proposed"])))
      .orderBy(asc(wikiRules.orderIndex)),
    db
      .select()
      .from(positions)
      .where(and(eq(positions.academyId, academy.id), eq(positions.archived, false)))
      .orderBy(asc(positions.title)),
    db
      .select({ positionId: positionHolders.positionId, name: users.name, startedAt: positionHolders.startedAt })
      .from(positionHolders)
      .innerJoin(users, eq(users.id, positionHolders.userId))
      .where(and(eq(positionHolders.academyId, academy.id), isNull(positionHolders.endedAt))),
  ]);

  const studioName = (id: number | null) =>
    id === null ? "Whole academy" : (studioRows.find((studio) => studio.id === id)?.name ?? "Unknown studio");
  const day = (date: Date) => date.toISOString().slice(0, 10);
  const lines: string[] = [`# ${academy.name}`, "", `Exported from Eagle Bot on ${day(new Date())}.`, ""];

  lines.push("## Wiki", "");
  for (const owner of [null, ...studioRows.map((studio) => studio.id)]) {
    const sections = sectionRows.filter((section) => section.studioId === owner);
    if (sections.length === 0) continue;
    lines.push(`### ${studioName(owner)}`, "");
    for (const section of sections) {
      lines.push(`#### ${section.title}`, "");
      if (section.summary) lines.push(section.summary, "");
      for (const rule of ruleRows.filter((row) => row.sectionId === section.id)) {
        lines.push(`**${rule.title}**${rule.status === "proposed" ? " *(proposed)*" : ""}`, "", rule.body, "");
        if (rule.citation) lines.push(`*Source: ${rule.citation}*`, "");
      }
    }
  }

  lines.push("## Positions", "");
  for (const position of positionRows) {
    lines.push(`### ${position.title}`, "", `*${studioName(position.studioId)}*`, "");
    if (position.description) lines.push(position.description, "");
    const details = [
      `Seats: ${position.seats}`,
      position.termLength ? `Term: ${position.termLength}` : null,
      position.elected ? "Elected" : "Appointed",
    ].filter(Boolean);
    lines.push(details.join(" · "), "");
    for (const duty of position.responsibilities ?? []) lines.push(`- ${duty}`);
    if (position.responsibilities?.length) lines.push("");
    const holders = holderRows.filter((holder) => holder.positionId === position.id);
    lines.push(
      holders.length
        ? `Held by: ${holders.map((holder) => `${holder.name} (since ${day(holder.startedAt)})`).join(", ")}`
        : "Held by: nobody right now",
      "",
    );
  }

  const filename = `${academy.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "academy"}-eagle-bot.md`;
  res.setHeader("Content-Type", "text/markdown; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(lines.join("\n"));
});
