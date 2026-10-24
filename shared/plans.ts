/**
 * Plans, the free demo and what each means for access. Shared so the client
 * words things the same way the server enforces them.
 */

import type { Plan } from "./schema";

/** Free access every new academy gets. Mirrors the column default on `academies`. */
export const DEMO_DAYS = 90;
/** The Founding Academy price is offered to this many academies, ever. */
export const FOUNDING_SPOTS = 10;
/** How long before the demo ends that everyone is asked for feedback. */
export const SURVEY_WINDOW_DAYS = 14;

/**
 * - `demo`: free, everything works.
 * - `paid`: a subscription Stripe says is in good standing.
 * - `read_only`: the demo is over and nothing is paid. Everything can be read
 *   and exported; nothing new can be made.
 */
export type AccessState = "demo" | "paid" | "read_only";

export type PlanPrice = { amount: number; currency: string } | null;

/** What GET /api/billing returns. */
export type BillingStatus = {
  access: AccessState;
  plan: Plan;
  demoEndsAt: string;
  /** Whole days left in the demo, never below zero. */
  daysLeft: number;
  /** True once the survey window has opened (or the demo is over). */
  surveyOpen: boolean;
  isAdmin: boolean;
  stripeConfigured: boolean;
  subscriptionStatus: string | null;
  myResponse: {
    rating: number;
    liked: string | null;
    improve: string | null;
    continueChoice: "yes" | "no" | "unsure" | null;
  } | null;
  /** Admins only from here down; null for everyone else. */
  foundingSpotsLeft: number | null;
  /** The plan a new subscription would be on: founding while spots last. */
  offer: Exclude<Plan, "demo"> | null;
  prices: Record<Exclude<Plan, "demo">, { month: PlanPrice; year: PlanPrice }> | null;
};

export const PLAN_LABELS: Record<Plan, string> = {
  demo: "Free demo",
  founding: "Founding Academy",
  academy: "Academy",
};
