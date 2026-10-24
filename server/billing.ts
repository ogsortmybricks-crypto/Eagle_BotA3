/**
 * The free demo, paid plans and the read-only state in between.
 *
 * Stripe is the record of who has paid. There are no webhooks: each Eagle Bot
 * is its own deployment, and asking every one of them to register an endpoint
 * with Stripe would be one more thing to forget. Instead the app confirms a
 * checkout when the admin comes back from it, and re-reads the subscription
 * every few hours to notice cancellations and failed payments.
 *
 * Founding Academy spots are counted in Stripe for the same reason - it is the
 * only place every deployment can see.
 */

import type { NextFunction, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { env, stripeConfigured } from "./env";
import { academies, type Academy, type Plan } from "@shared/schema";
import { FOUNDING_SPOTS, SURVEY_WINDOW_DAYS, type AccessState, type PlanPrice } from "@shared/plans";

const DAY = 86_400_000;
/** Statuses that keep the app writable. past_due is Stripe still retrying a card. */
const GOOD_STANDING = new Set(["active", "trialing", "past_due"]);
/** Statuses that hold a Founding spot. An abandoned checkout ("incomplete") doesn't. */
const HOLDS_SPOT = new Set(["active", "trialing", "past_due", "unpaid"]);
const RECHECK_MS = 6 * 60 * 60_000;

export function accessFor(academy: Academy, now = new Date()): AccessState {
  if (academy.plan !== "demo" && academy.subscriptionStatus && GOOD_STANDING.has(academy.subscriptionStatus)) {
    return "paid";
  }
  return now < academy.demoEndsAt ? "demo" : "read_only";
}

export function demoDaysLeft(academy: Academy, now = new Date()): number {
  return Math.max(0, Math.ceil((academy.demoEndsAt.getTime() - now.getTime()) / DAY));
}

export function surveyOpen(academy: Academy, now = new Date()): boolean {
  return academy.demoEndsAt.getTime() - now.getTime() <= SURVEY_WINDOW_DAYS * DAY;
}

/* -------------------------------------------------------------------------- */
/*  Stripe                                                                     */
/* -------------------------------------------------------------------------- */

export class StripeError extends Error {}

/** Stripe's form encoding: nested objects and arrays become `a[b][0][c]=...`. */
function encode(params: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(params).flatMap(([key, value]) => {
    const name = prefix ? `${prefix}[${key}]` : key;
    if (value === undefined || value === null) return [];
    if (typeof value === "object") return encode(value as Record<string, unknown>, name);
    return [`${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`];
  });
}

export async function stripe<T>(
  method: "GET" | "POST",
  path: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  if (!env.stripe.secretKey) throw new StripeError("Payments aren't set up on this Eagle Bot yet.");
  const query = encode(params).join("&");
  const response = await fetch(`https://api.stripe.com/v1${path}${method === "GET" && query ? `?${query}` : ""}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.stripe.secretKey}`,
      ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: method === "POST" ? query : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
  if (!response.ok) {
    console.error("[billing] stripe", method, path, response.status, payload.error?.message);
    throw new StripeError(payload.error?.message ?? `Stripe returned ${response.status}.`);
  }
  return payload as T;
}

type StripeList<T> = { data: T[]; has_more: boolean };
type StripeSubscription = { id: string; status: string; customer: string };
type StripePrice = { unit_amount: number | null; currency: string };

let spotsCache: { value: number; at: number } | null = null;

/** Founding spots still open, across every deployment on this Stripe account. */
export async function foundingSpotsLeft(): Promise<number | null> {
  if (!stripeConfigured) return null;
  if (spotsCache && Date.now() - spotsCache.at < 60_000) return spotsCache.value;
  let taken = 0;
  for (const price of Object.values(env.stripe.prices.founding)) {
    const list = await stripe<StripeList<StripeSubscription>>("GET", "/subscriptions", {
      price,
      status: "all",
      limit: 100,
    });
    taken += list.data.filter((subscription) => HOLDS_SPOT.has(subscription.status)).length;
  }
  const value = Math.max(0, FOUNDING_SPOTS - taken);
  spotsCache = { value, at: Date.now() };
  return value;
}

export function forgetFoundingSpots() {
  spotsCache = null;
}

let priceCache: { value: Record<Exclude<Plan, "demo">, { month: PlanPrice; year: PlanPrice }>; at: number } | null =
  null;

/** What each plan costs, read from Stripe so the page can't disagree with the invoice. */
export async function planPrices() {
  if (!stripeConfigured) return null;
  if (priceCache && Date.now() - priceCache.at < 10 * 60_000) return priceCache.value;
  const read = async (id: string): Promise<PlanPrice> => {
    const price = await stripe<StripePrice>("GET", `/prices/${id}`);
    return price.unit_amount === null ? null : { amount: price.unit_amount / 100, currency: price.currency };
  };
  const { founding, academy } = env.stripe.prices;
  const value = {
    founding: { month: await read(founding.month), year: await read(founding.year) },
    academy: { month: await read(academy.month), year: await read(academy.year) },
  };
  priceCache = { value, at: Date.now() };
  return value;
}

/** Which plan a Stripe price belongs to, or null if it isn't one of ours. */
export function planForPrice(priceId: string): Exclude<Plan, "demo"> | null {
  const { founding, academy } = env.stripe.prices;
  if (priceId === founding.month || priceId === founding.year) return "founding";
  if (priceId === academy.month || priceId === academy.year) return "academy";
  return null;
}

/**
 * Re-reads the academy's subscription from Stripe when the copy here is a few
 * hours old. Never throws: if Stripe can't be reached, the last known status
 * stands, so an outage at Stripe doesn't lock anyone out.
 */
export async function refreshSubscription(academy: Academy, force = false): Promise<Academy> {
  if (!academy.stripeSubscriptionId || !env.stripe.secretKey) return academy;
  const checked = academy.subscriptionCheckedAt?.getTime() ?? 0;
  if (!force && Date.now() - checked < RECHECK_MS) return academy;
  try {
    const subscription = await stripe<StripeSubscription>("GET", `/subscriptions/${academy.stripeSubscriptionId}`);
    const [updated] = await db
      .update(academies)
      .set({ subscriptionStatus: subscription.status, subscriptionCheckedAt: new Date() })
      .where(eq(academies.id, academy.id))
      .returning();
    return updated ?? academy;
  } catch (error) {
    console.error("[billing] couldn't refresh subscription", academy.id, error);
    return academy;
  }
}

/* -------------------------------------------------------------------------- */
/*  Read-only                                                                  */
/* -------------------------------------------------------------------------- */

const STILL_ALLOWED = new Set(["/api/studios/select", "/api/tacons/dev/check"]);

/**
 * Once the demo is over and nothing is paid, the academy can look but not
 * change anything. Reads always go through, so the wiki and positions stay
 * available - and exportable - no matter what.
 */
export async function requireWritable(req: Request, res: Response, next: NextFunction) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  if (!req.academy) return next();
  // POSTs that only change what this person is looking at, not the academy.
  if (STILL_ALLOWED.has(req.originalUrl.split("?")[0])) return next();
  req.academy = await refreshSubscription(req.academy);
  if (accessFor(req.academy) !== "read_only") return next();
  res.status(402).json({
    error:
      req.user?.role === "admin"
        ? "Your free demo has ended, so Eagle Bot is read-only. Pick a plan on the Plan & billing page to keep going."
        : "Your academy's free demo has ended, so Eagle Bot is read-only for now. An admin can pick a plan to keep going.",
    readOnly: true,
  });
}
