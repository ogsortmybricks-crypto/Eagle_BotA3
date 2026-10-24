/**
 * The dev portal's Support and Academies tabs: answering Help-button
 * messages, and seeing where each academy is in its demo and what its people
 * said in the survey.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Send, Star } from "lucide-react";
import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { Banner, Chip, Spinner } from "@/components/ui";
import { FOUNDING_SPOTS, PLAN_LABELS } from "@shared/plans";
import type { Plan } from "@shared/schema";

type PortalTicket = {
  id: number;
  kind: string;
  subject: string;
  status: "open" | "answered" | "closed";
  page: string | null;
  updatedAt: string;
  academyName: string;
  userName: string | null;
  userRole: string | null;
  userEmail: string | null;
  replies: { id: number; body: string; createdAt: string; fromSupport: boolean; devName: string | null }[];
};

const STATUS_TONE = { open: "amber", answered: "green", closed: "neutral" } as const;

export function PortalSupport() {
  const [filter, setFilter] = useState<"open" | "answered" | "closed" | "all">("open");
  const query = useQuery<{ tickets: PortalTicket[] }>({
    queryKey: ["portal-support", filter],
    queryFn: () => apiGet(`/portal/support?status=${filter}`),
    refetchInterval: 60_000,
  });
  const tickets = query.data?.tickets ?? [];

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        {(["open", "answered", "closed", "all"] as const).map((key) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`chip capitalize ${filter === key ? "bg-brand-600 text-white" : "bg-gray-800 text-gray-300"}`}
          >
            {key}
          </button>
        ))}
      </div>
      {query.isLoading ? (
        <Spinner />
      ) : tickets.length === 0 ? (
        <p className="text-sm text-gray-400">Nothing {filter === "all" ? "yet" : filter}.</p>
      ) : (
        <div className="space-y-3">
          {tickets.map((ticket) => (
            <TicketCard key={ticket.id} ticket={ticket} />
          ))}
        </div>
      )}
    </div>
  );
}

function TicketCard({ ticket }: { ticket: PortalTicket }) {
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["portal-support"] });

  const answer = useMutation({
    mutationFn: (close: boolean) => apiPost(`/portal/support/${ticket.id}/replies`, { body, close }),
    onSuccess: () => {
      setBody("");
      void refresh();
    },
  });
  const setStatus = useMutation({
    mutationFn: (status: PortalTicket["status"]) => apiPatch(`/portal/support/${ticket.id}`, { status }),
    onSuccess: refresh,
  });

  return (
    <div className="card-pad">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-gray-900">{ticket.subject}</h3>
          <p className="text-xs text-gray-500">
            {ticket.userName ?? "Someone who has left"}
            {ticket.userRole && ` (${ticket.userRole})`} · {ticket.academyName}
            {ticket.userEmail && ` · ${ticket.userEmail}`}
            {ticket.page && ` · on ${ticket.page}`}
          </p>
        </div>
        <div className="flex gap-1.5">
          <Chip>{ticket.kind}</Chip>
          <Chip tone={STATUS_TONE[ticket.status]}>{ticket.status}</Chip>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {ticket.replies.map((message) => (
          <div
            key={message.id}
            className={`rounded-lg p-3 text-sm ${message.fromSupport ? "ml-8 bg-brand-50 text-gray-900" : "mr-8 bg-gray-100 text-gray-800"}`}
          >
            <div className="mb-1 text-xs font-medium text-gray-500">
              {message.fromSupport ? (message.devName ?? "Portal") : (ticket.userName ?? "Them")} ·{" "}
              {new Date(message.createdAt).toLocaleString()}
            </div>
            <div className="whitespace-pre-wrap">{message.body}</div>
          </div>
        ))}
      </div>

      <div className="mt-3 space-y-2">
        {answer.error && <Banner tone="error">{answer.error.message}</Banner>}
        <textarea
          className="input min-h-[80px]"
          placeholder="Write an answer. They see it behind the Help button, and by email."
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          <button onClick={() => answer.mutate(false)} disabled={answer.isPending || !body.trim()} className="btn-primary btn-sm">
            {answer.isPending ? <Spinner /> : <Send className="h-3.5 w-3.5" />} Answer
          </button>
          <button onClick={() => answer.mutate(true)} disabled={answer.isPending || !body.trim()} className="btn-secondary btn-sm">
            Answer and close
          </button>
          {ticket.status !== "closed" ? (
            <button onClick={() => setStatus.mutate("closed")} className="btn-ghost btn-sm">
              Close without answering
            </button>
          ) : (
            <button onClick={() => setStatus.mutate("open")} className="btn-ghost btn-sm">
              Reopen
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

type PortalAcademy = {
  id: number;
  name: string;
  createdAt: string;
  plan: Plan;
  access: "demo" | "paid" | "read_only";
  demoEndsAt: string;
  daysLeft: number;
  subscriptionStatus: string | null;
  surveys: {
    id: number;
    rating: number;
    liked: string | null;
    improve: string | null;
    continueChoice: string | null;
    updatedAt: string;
    userName: string | null;
    userRole: string | null;
  }[];
};

const ACCESS_LABEL = {
  demo: { tone: "blue", label: "In demo" },
  paid: { tone: "green", label: "Paying" },
  read_only: { tone: "red", label: "Read-only" },
} as const;

export function PortalAcademies() {
  const queryClient = useQueryClient();
  const query = useQuery<{ foundingSpotsLeft: number | null; academies: PortalAcademy[] }>({
    queryKey: ["portal-academies"],
    queryFn: () => apiGet("/portal/academies"),
  });
  const extend = useMutation({
    mutationFn: ({ id, days }: { id: number; days: number }) => apiPost(`/portal/academies/${id}/extend`, { days }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["portal-academies"] }),
  });

  if (query.isLoading) return <Spinner />;
  const data = query.data;

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-400">
        {data?.foundingSpotsLeft === null || data?.foundingSpotsLeft === undefined
          ? "Founding spots: Stripe isn't set up on this deployment."
          : `Founding spots left: ${data.foundingSpotsLeft} of ${FOUNDING_SPOTS} (counted across every deployment on your Stripe account).`}
      </p>
      {extend.error && <Banner tone="error">{extend.error.message}</Banner>}
      {(data?.academies ?? []).map((academy) => (
        <div key={academy.id} className="card-pad">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="font-semibold text-gray-900">{academy.name}</h3>
              <p className="text-xs text-gray-500">
                {PLAN_LABELS[academy.plan]}
                {academy.subscriptionStatus && ` · Stripe: ${academy.subscriptionStatus}`} · demo{" "}
                {academy.daysLeft > 0 ? `ends in ${academy.daysLeft} days` : "ended"} (
                {new Date(academy.demoEndsAt).toLocaleDateString()})
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Chip tone={ACCESS_LABEL[academy.access].tone}>{ACCESS_LABEL[academy.access].label}</Chip>
              {academy.access !== "paid" && (
                <button
                  onClick={() => extend.mutate({ id: academy.id, days: 30 })}
                  disabled={extend.isPending}
                  className="btn-secondary btn-sm"
                >
                  +30 days
                </button>
              )}
            </div>
          </div>

          {academy.surveys.length === 0 ? (
            <p className="mt-3 text-sm text-gray-500">No survey answers yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-gray-100">
              {academy.surveys.map((survey) => (
                <li key={survey.id} className="py-2.5 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-gray-900">{survey.userName ?? "Someone who has left"}</span>
                    {survey.userRole && <Chip>{survey.userRole}</Chip>}
                    <span className="flex items-center gap-0.5 text-amber-500" aria-label={`${survey.rating} out of 5`}>
                      {Array.from({ length: survey.rating }, (_, index) => (
                        <Star key={index} className="h-3.5 w-3.5 fill-current" />
                      ))}
                    </span>
                    {survey.continueChoice && (
                      <Chip tone={survey.continueChoice === "yes" ? "green" : survey.continueChoice === "no" ? "red" : "amber"}>
                        keep it: {survey.continueChoice}
                      </Chip>
                    )}
                  </div>
                  {survey.liked && <p className="mt-1 text-gray-700"><span className="text-gray-500">Liked:</span> {survey.liked}</p>}
                  {survey.improve && <p className="mt-0.5 text-gray-700"><span className="text-gray-500">Improve:</span> {survey.improve}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
