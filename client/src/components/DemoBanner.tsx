/**
 * The strip at the top of every page that says where the academy stands:
 * how long the free demo has left, that it's time for the survey, or that the
 * demo is over and Eagle Bot is read-only. Says nothing once a plan is paid.
 */

import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { BillingStatus } from "@shared/plans";
import { Banner } from "./ui";

export function DemoBanner() {
  const { user } = useSession();
  const [location] = useLocation();
  const query = useQuery<BillingStatus>({
    queryKey: ["billing"],
    queryFn: () => apiGet("/billing"),
    enabled: Boolean(user),
    staleTime: 10 * 60_000,
  });
  const status = query.data;

  // The plan page says all of this itself.
  if (!status || location === "/plan" || status.access === "paid") return null;

  const days = `${status.daysLeft} day${status.daysLeft === 1 ? "" : "s"}`;
  const link = (label: string) => (
    <Link href="/plan" className="btn-secondary btn-sm whitespace-nowrap">
      {label}
    </Link>
  );

  if (status.access === "read_only") {
    return (
      <div className="mb-5">
        <Banner
          tone="warning"
          title="The free demo has ended, so Eagle Bot is read-only"
          action={link(status.isAdmin ? "Pick a plan" : "Tell us what you think")}
        >
          {status.isAdmin
            ? "Everything is still here to read and export. Pick a plan to keep making changes."
            : "Everything is still here to read. An admin can pick a plan to keep going."}
        </Banner>
      </div>
    );
  }

  if (status.surveyOpen) {
    // Once someone has answered, the admins still need the countdown; everyone else is done.
    if (status.myResponse && !status.isAdmin) return null;
    return (
      <div className="mb-5">
        <Banner
          tone="info"
          title={`The free demo ends in ${days}`}
          action={link(status.myResponse ? "Pick a plan" : "Take the survey")}
        >
          {status.isAdmin
            ? "Tell us how it went and whether you'd like to keep Eagle Bot."
            : "Tell us how it's gone. It takes a minute and helps decide what happens next."}
        </Banner>
      </div>
    );
  }

  // Early in the demo, only admins need reminding that it's a demo.
  if (!status.isAdmin) return null;
  return (
    <div className="mb-5">
      <Banner tone="info" title={`Free demo: ${days} left`} action={link("Plan & billing")} />
    </div>
  );
}
