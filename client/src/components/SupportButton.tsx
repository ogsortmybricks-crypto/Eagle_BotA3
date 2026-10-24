/**
 * The Help button.
 *
 * Always in the corner, on every page, for everyone: a question, a request,
 * something broken. It goes to the people who make Eagle Bot, who answer from
 * the dev portal, and the answer comes back here. Nobody else in the academy
 * sees what you sent.
 */

import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, LifeBuoy, Send } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Banner, Chip, Modal, Spinner } from "./ui";

type Reply = { id: number; userId: number | null; body: string; createdAt: string; fromSupport: boolean; devName: string | null };
type Ticket = {
  id: number;
  kind: string;
  subject: string;
  status: "open" | "answered" | "closed";
  createdAt: string;
  updatedAt: string;
  replies: Reply[];
  unread: boolean;
};

const KINDS = [
  ["question", "A question"],
  ["request", "A feature request"],
  ["problem", "Something's broken"],
  ["feedback", "General feedback"],
] as const;

const STATUS_CHIP = {
  open: { tone: "amber", label: "Waiting for an answer" },
  answered: { tone: "green", label: "Answered" },
  closed: { tone: "neutral", label: "Closed" },
} as const;

export function SupportButton({ className = "bottom-5 right-5" }: { className?: string }) {
  const { user } = useSession();
  const [open, setOpen] = useState(false);

  const query = useQuery<{ tickets: Ticket[]; unread: number }>({
    queryKey: ["support"],
    queryFn: () => apiGet("/support"),
    enabled: Boolean(user),
    refetchInterval: open ? 30_000 : 5 * 60_000,
  });
  const unread = query.data?.unread ?? 0;

  if (!user) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`fixed z-40 flex items-center gap-2 rounded-full bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:bg-brand-700 ${className}`}
        aria-label={unread ? `Help and feedback, ${unread} new answer${unread === 1 ? "" : "s"}` : "Help and feedback"}
      >
        <LifeBuoy className="h-4 w-4" /> Help
        {unread > 0 && (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-white px-1.5 text-xs font-bold text-brand-700">
            {unread}
          </span>
        )}
      </button>
      {open && <SupportPanel tickets={query.data?.tickets ?? []} loading={query.isLoading} onClose={() => setOpen(false)} />}
    </>
  );
}

function SupportPanel({ tickets, loading, onClose }: { tickets: Ticket[]; loading: boolean; onClose: () => void }) {
  const [view, setView] = useState<"new" | "list" | number>(tickets.some((ticket) => ticket.unread) ? "list" : "new");
  const selected = typeof view === "number" ? tickets.find((ticket) => ticket.id === view) : undefined;

  return (
    <Modal
      open
      onClose={onClose}
      title="Help & feedback"
      description="Ask a question, request a feature or tell us what's broken. The team that makes Eagle Bot reads every message."
    >
      <div className="mb-4 flex gap-2">
        <button onClick={() => setView("new")} className={`chip ${view === "new" ? "bg-brand-600 text-white" : "bg-gray-100 text-gray-700"}`}>
          New message
        </button>
        <button
          onClick={() => setView("list")}
          className={`chip ${view !== "new" ? "bg-brand-600 text-white" : "bg-gray-100 text-gray-700"}`}
        >
          My messages{tickets.length > 0 && ` (${tickets.length})`}
        </button>
      </div>

      {view === "new" && <NewMessage onSent={() => setView("list")} />}
      {view === "list" &&
        (loading ? (
          <div className="flex justify-center py-6"><Spinner /></div>
        ) : tickets.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-500">You haven't sent anything yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {tickets.map((ticket) => (
              <li key={ticket.id}>
                <button onClick={() => setView(ticket.id)} className="flex w-full items-start gap-3 py-3 text-left">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {ticket.unread && <span className="h-2 w-2 shrink-0 rounded-full bg-brand-600" aria-label="New answer" />}
                      <span className="truncate font-medium text-gray-900">{ticket.subject}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-gray-500">{new Date(ticket.updatedAt).toLocaleDateString()}</div>
                  </div>
                  <Chip tone={STATUS_CHIP[ticket.status].tone}>{STATUS_CHIP[ticket.status].label}</Chip>
                </button>
              </li>
            ))}
          </ul>
        ))}
      {selected && <Thread ticket={selected} onBack={() => setView("list")} />}
    </Modal>
  );
}

function NewMessage({ onSent }: { onSent: () => void }) {
  const queryClient = useQueryClient();
  const [location] = useLocation();
  const [form, setForm] = useState({ kind: "question", subject: "", body: "" });

  const send = useMutation({
    mutationFn: () => apiPost("/support", { ...form, page: location }),
    onSuccess: () => {
      setForm({ kind: "question", subject: "", body: "" });
      void queryClient.invalidateQueries({ queryKey: ["support"] });
      onSent();
    },
  });

  return (
    <div className="space-y-3">
      {send.error && <Banner tone="error">{send.error.message}</Banner>}
      <div>
        <label className="label" htmlFor="support-kind">What is it?</label>
        <select id="support-kind" className="input" value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value })}>
          {KINDS.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="support-subject">Subject</label>
        <input
          id="support-subject"
          className="input"
          maxLength={140}
          value={form.subject}
          onChange={(event) => setForm({ ...form, subject: event.target.value })}
        />
      </div>
      <div>
        <label className="label" htmlFor="support-body">Message</label>
        <textarea
          id="support-body"
          className="input min-h-[120px]"
          maxLength={5000}
          value={form.body}
          onChange={(event) => setForm({ ...form, body: event.target.value })}
        />
        <p className="hint">We'll answer here, and by email.</p>
      </div>
      <button
        onClick={() => send.mutate()}
        disabled={send.isPending || form.subject.trim().length < 3 || form.body.trim().length < 3}
        className="btn-primary w-full"
      >
        {send.isPending ? <Spinner /> : <Send className="h-4 w-4" />} Send
      </button>
    </div>
  );
}

function Thread({ ticket, onBack }: { ticket: Ticket; onBack: () => void }) {
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");

  // Opening it is reading it.
  const unread = ticket.unread;
  useEffect(() => {
    if (!unread) return;
    void apiPost(`/support/${ticket.id}/seen`).then(() => queryClient.invalidateQueries({ queryKey: ["support"] }));
  }, [ticket.id, unread, queryClient]);

  const reply = useMutation({
    mutationFn: () => apiPost(`/support/${ticket.id}/replies`, { body }),
    onSuccess: () => {
      setBody("");
      void queryClient.invalidateQueries({ queryKey: ["support"] });
    },
  });

  return (
    <div className="-mt-4">
      <button onClick={onBack} className="btn-ghost mb-2 -ml-2 px-2 text-xs">
        <ChevronLeft className="h-3.5 w-3.5" /> All messages
      </button>
      <h3 className="font-semibold text-gray-900">{ticket.subject}</h3>
      <div className="mt-3 space-y-2">
        {ticket.replies.map((message) => (
          <div
            key={message.id}
            className={`rounded-lg p-3 text-sm ${message.fromSupport ? "mr-8 bg-brand-50 text-gray-900" : "ml-8 bg-gray-100 text-gray-800"}`}
          >
            <div className="mb-1 text-xs font-medium text-gray-500">
              {message.fromSupport ? (message.devName ?? "Eagle Bot team") : "You"} ·{" "}
              {new Date(message.createdAt).toLocaleString()}
            </div>
            <div className="whitespace-pre-wrap">{message.body}</div>
          </div>
        ))}
      </div>
      <div className="mt-4 space-y-2">
        {reply.error && <Banner tone="error">{reply.error.message}</Banner>}
        <textarea
          className="input min-h-[80px]"
          placeholder={ticket.status === "closed" ? "Reply to reopen this" : "Add a reply"}
          maxLength={5000}
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
        <button onClick={() => reply.mutate()} disabled={reply.isPending || !body.trim()} className="btn-primary btn-sm">
          {reply.isPending ? <Spinner /> : <Send className="h-3.5 w-3.5" />} Reply
        </button>
      </div>
    </div>
  );
}
