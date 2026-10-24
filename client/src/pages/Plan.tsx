import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CreditCard, Download, ExternalLink, Star } from "lucide-react";
import { apiGet, apiPost, apiPut } from "@/lib/api";
import { Banner, LoadingPage, PageHeader, Spinner } from "@/components/ui";
import { FOUNDING_SPOTS, PLAN_LABELS, type BillingStatus, type PlanPrice } from "@shared/plans";

/**
 * Plan & billing: how long the free demo has left, the survey, and - for
 * admins - picking a plan and taking the wiki with you.
 */
export function Plan() {
  const queryClient = useQueryClient();
  const query = useQuery<BillingStatus>({ queryKey: ["billing"], queryFn: () => apiGet("/billing") });

  // Coming back from Stripe. The browser's word isn't proof of payment, so the
  // server asks Stripe before anything changes.
  const [returned] = useState(() => new URLSearchParams(window.location.search));
  const confirm = useMutation({
    mutationFn: (sessionId: string) => apiPost<{ plan: string }>("/billing/confirm", { sessionId }),
    onSettled: () => {
      window.history.replaceState(null, "", "/plan");
      void queryClient.invalidateQueries({ queryKey: ["billing"] });
    },
  });
  useEffect(() => {
    const sessionId = returned.get("session_id");
    if (returned.get("checkout") === "success" && sessionId) confirm.mutate(sessionId);
    else if (returned.has("checkout")) window.history.replaceState(null, "", "/plan");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (query.isLoading || !query.data) return <LoadingPage />;
  const status = query.data;
  const ends = new Date(status.demoEndsAt).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });

  return (
    <div className="max-w-3xl">
      <PageHeader title="Plan & billing" subtitle={PLAN_LABELS[status.plan]} />

      <div className="space-y-5">
        {confirm.isPending && <Banner tone="info" title="Checking your payment with Stripe..." />}
        {confirm.isError && <Banner tone="error" title="We couldn't confirm that payment">{confirm.error.message}</Banner>}
        {confirm.isSuccess && (
          <Banner tone="success" title="You're all set">
            Thank you for keeping Eagle Bot. Your academy is on the {PLAN_LABELS[confirm.data.plan as BillingStatus["plan"]]} plan.
          </Banner>
        )}
        {returned.get("checkout") === "cancelled" && <Banner tone="info">Checkout was cancelled. Nothing was charged.</Banner>}

        {status.access === "demo" && (
          <Banner tone={status.surveyOpen ? "warning" : "info"} title={`Free demo: ${status.daysLeft} day${status.daysLeft === 1 ? "" : "s"} left`}>
            Everything is free until {ends}. After that, Eagle Bot becomes read-only unless an admin picks a plan.
          </Banner>
        )}
        {status.access === "read_only" && (
          <Banner tone="warning" title={`Your free demo ended on ${ends}`}>
            Eagle Bot is read-only: everyone can still read the wiki, positions and history, but nothing new can be made
            until an admin picks a plan. Nothing has been deleted.
          </Banner>
        )}
        {status.access === "paid" && (
          <Banner tone="success" title={`You're on the ${PLAN_LABELS[status.plan]} plan`}>
            {status.subscriptionStatus === "past_due"
              ? "Your last payment didn't go through. Stripe will try again; update your card under Manage billing."
              : "Thank you for using Eagle Bot."}
          </Banner>
        )}

        {status.access !== "paid" && <Survey status={status} />}
        {status.isAdmin && <PickPlan status={status} />}
        {status.isAdmin && <Export />}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Survey({ status }: { status: BillingStatus }) {
  const queryClient = useQueryClient();
  const mine = status.myResponse;
  const [form, setForm] = useState({
    rating: mine?.rating ?? 0,
    liked: mine?.liked ?? "",
    improve: mine?.improve ?? "",
    continueChoice: mine?.continueChoice ?? null,
  });
  const save = useMutation({
    mutationFn: () => apiPut("/billing/survey", { ...form, continueChoice: form.continueChoice ?? undefined }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["billing"] }),
  });

  return (
    <section className="card-pad">
      <h2 className="font-semibold text-gray-900">How has the demo gone?</h2>
      <p className="hint">
        {status.isAdmin
          ? "Your answers go straight to the person who makes Eagle Bot. You can change them any time."
          : "Your answers go straight to the person who makes Eagle Bot, and help your admins decide whether to keep it."}
      </p>

      <div className="mt-4 space-y-4">
        <div>
          <div className="label">Overall</div>
          <div className="flex gap-1" role="radiogroup" aria-label="Rating from 1 to 5">
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                role="radio"
                aria-checked={form.rating === value}
                aria-label={`${value} out of 5`}
                onClick={() => setForm({ ...form, rating: value })}
                className="rounded p-1 transition hover:bg-gray-100"
              >
                <Star className={`h-7 w-7 ${value <= form.rating ? "fill-amber-400 text-amber-400" : "text-gray-300"}`} />
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="label" htmlFor="survey-liked">What's worked well?</label>
          <textarea id="survey-liked" className="input min-h-[80px]" maxLength={2000} value={form.liked} onChange={(event) => setForm({ ...form, liked: event.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor="survey-improve">What should be better?</label>
          <textarea id="survey-improve" className="input min-h-[80px]" maxLength={2000} value={form.improve} onChange={(event) => setForm({ ...form, improve: event.target.value })} />
        </div>
        {status.isAdmin && (
          <div>
            <div className="label">Would your academy like to keep using Eagle Bot?</div>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["yes", "Yes"],
                  ["unsure", "Not sure yet"],
                  ["no", "No"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setForm({ ...form, continueChoice: value })}
                  className={form.continueChoice === value ? "btn-primary btn-sm" : "btn-secondary btn-sm"}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
        {save.error && <Banner tone="error">{save.error.message}</Banner>}
        {save.isSuccess && <Banner tone="success">Thanks, your answers are saved.</Banner>}
        <button onClick={() => save.mutate()} disabled={save.isPending || form.rating === 0} className="btn-primary">
          {save.isPending ? <Spinner /> : <CheckCircle2 className="h-4 w-4" />} {mine ? "Update my answers" : "Send"}
        </button>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */

function money(price: PlanPrice) {
  if (!price) return "-";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: price.currency.toUpperCase(),
    maximumFractionDigits: price.amount % 1 === 0 ? 0 : 2,
  }).format(price.amount);
}

function PickPlan({ status }: { status: BillingStatus }) {
  const [interval, setBillingInterval] = useState<"month" | "year">("year");
  const checkout = useMutation({
    mutationFn: () => apiPost<{ url: string }>("/billing/checkout", { interval }),
    onSuccess: (data) => window.location.assign(data.url),
  });
  const manage = useMutation({
    mutationFn: () => apiPost<{ url: string }>("/billing/manage"),
    onSuccess: (data) => window.location.assign(data.url),
  });

  if (status.access === "paid") {
    return (
      <section className="card-pad">
        <h2 className="font-semibold text-gray-900">Billing</h2>
        <p className="hint">Change your card, switch between monthly and yearly, see invoices or cancel, on Stripe.</p>
        {manage.error && <div className="mt-3"><Banner tone="error">{manage.error.message}</Banner></div>}
        <button onClick={() => manage.mutate()} disabled={manage.isPending} className="btn-secondary mt-3">
          {manage.isPending ? <Spinner /> : <ExternalLink className="h-4 w-4" />} Manage billing
        </button>
      </section>
    );
  }

  if (!status.stripeConfigured) {
    return (
      <section className="card-pad">
        <h2 className="font-semibold text-gray-900">Keep Eagle Bot</h2>
        <p className="mt-1 text-sm text-gray-600">
          Online payment isn't set up on this Eagle Bot yet. Use the Help button to tell us you'd like to keep it, and
          we'll sort it out with you.
        </p>
      </section>
    );
  }

  if (!status.offer || !status.prices) {
    return (
      <section className="card-pad">
        <Banner tone="warning">We couldn't load plans from Stripe just now. Try again in a few minutes.</Banner>
      </section>
    );
  }

  const founding = status.offer === "founding";
  const price = status.prices[status.offer];

  return (
    <section className="card-pad">
      <h2 className="font-semibold text-gray-900">Keep Eagle Bot</h2>
      {founding ? (
        <p className="mt-1 text-sm text-gray-600">
          <strong>{status.foundingSpotsLeft} of {FOUNDING_SPOTS}</strong> Founding Academy spots are left. The Founding price
          stays locked for as long as your academy stays.
        </p>
      ) : (
        <p className="mt-1 text-sm text-gray-600">
          All {FOUNDING_SPOTS} Founding Academy spots have been taken, so new academies join on the Academy plan.
        </p>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {(["month", "year"] as const).map((option) => (
          <button
            key={option}
            onClick={() => setBillingInterval(option)}
            className={`rounded-lg border-2 p-4 text-left transition ${
              interval === option ? "border-brand-600 bg-brand-50" : "border-gray-200 hover:border-gray-300"
            }`}
            aria-pressed={interval === option}
          >
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{option === "month" ? "Monthly" : "Yearly"}</div>
            <div className="mt-1 text-2xl font-bold text-gray-900">
              {money(price[option])}
              <span className="text-sm font-medium text-gray-500">/{option}</span>
            </div>
            {option === "year" && <div className="mt-1 text-xs text-emerald-700">Two months free</div>}
          </button>
        ))}
      </div>

      <p className="hint mt-3">
        {PLAN_LABELS[status.offer]} plan: every feature, every studio, no charge per learner. You'll pay on Stripe and come
        straight back here.
      </p>
      {checkout.error && <div className="mt-3"><Banner tone="error">{checkout.error.message}</Banner></div>}
      <button onClick={() => checkout.mutate()} disabled={checkout.isPending} className="btn-primary mt-3">
        {checkout.isPending ? <Spinner /> : <CreditCard className="h-4 w-4" />} Continue to checkout
      </button>
    </section>
  );
}

function Export() {
  return (
    <section className="card-pad">
      <h2 className="font-semibold text-gray-900">Export</h2>
      <p className="hint">
        Every studio's wiki and every position, with who holds it now, as one Markdown file. Works whatever plan you're
        on, including after a demo ends.
      </p>
      <a href="/api/billing/export" className="btn-secondary mt-3 inline-flex" download>
        <Download className="h-4 w-4" /> Download wiki & positions
      </a>
    </section>
  );
}
