/**
 * The dev portal - Ctrl+D.
 *
 * Deliberately not part of the academy app: its own sign-in, its own accounts,
 * its own dark chrome so nobody confuses the two. Portal devs publish the
 * official Tac-Ons and send the notices every academy sees.
 *
 * It renders outside the academy Layout, which is why this file draws its own
 * header rather than reusing the sidebar.
 */

import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  BadgeCheck,
  Ban,
  Bell,
  KeyRound,
  Megaphone,
  Rocket,
  Terminal,
  Users,
} from "lucide-react";
import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { Banner, Chip, LoadingPage, Spinner } from "@/components/ui";
import { compile, type Diagnostic } from "@shared/tacons";

type PortalStatus = {
  needsSetup: boolean;
  setupKeyRequired: boolean;
  dev: { id: number; name: string; email: string; head: boolean } | null;
};

export function DevPortal({ inviteToken }: { inviteToken?: string }) {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();

  const status = useQuery<PortalStatus>({
    queryKey: ["portal-status"],
    queryFn: () => apiGet("/portal/status"),
    retry: false,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["portal-status"] });

  if (status.isLoading) {
    return <Shell>{<LoadingPage label="Opening the portal..." />}</Shell>;
  }

  const data = status.data!;

  if (inviteToken && !data.dev) {
    return (
      <Shell>
        <AcceptInvite token={inviteToken} onDone={refresh} />
      </Shell>
    );
  }

  if (!data.dev) {
    return (
      <Shell>
        {data.needsSetup ? (
          <ClaimPortal keyRequired={data.setupKeyRequired} onDone={refresh} />
        ) : (
          <PortalLogin onDone={refresh} />
        )}
        <button
          onClick={() => navigate("/")}
          className="mx-auto mt-6 flex items-center gap-2 text-sm text-gray-400 hover:text-gray-200"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Eagle Bot
        </button>
      </Shell>
    );
  }

  return <PortalHome dev={data.dev} onSignedOut={refresh} />;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-900 px-4 py-12">
      <div className="mb-6 flex items-center gap-2 text-gray-100">
        <Terminal className="h-5 w-5" />
        <span className="text-lg font-bold tracking-tight">Eagle Bot — dev portal</span>
      </div>
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}

/* --------------------------------- getting in ----------------------------- */

function ClaimPortal({ keyRequired, onDone }: { keyRequired: boolean; onDone: () => void }) {
  const [form, setForm] = useState({ name: "", email: "", password: "", key: "" });
  const [error, setError] = useState<string | null>(null);

  const claim = useMutation({
    mutationFn: () => apiPost("/portal/setup", form),
    onSuccess: onDone,
    onError: (claimError: Error) => setError(claimError.message),
  });

  return (
    <div className="card-pad">
      <h1 className="text-lg font-bold text-gray-900">Claim the portal</h1>
      <p className="mt-1 text-sm text-gray-500">
        Nobody holds the head dev account yet. Whoever claims it can invite the rest and publish
        official Tac-Ons — so it happens exactly once.
      </p>
      <div className="mt-4 space-y-3">
        {error && <Banner tone="error">{error}</Banner>}
        <Input label="Name" value={form.name} onChange={(name) => setForm({ ...form, name })} />
        <Input
          label="Email"
          type="email"
          value={form.email}
          onChange={(email) => setForm({ ...form, email })}
        />
        <Input
          label="Password"
          type="password"
          value={form.password}
          onChange={(password) => setForm({ ...form, password })}
          hint="At least 10 characters."
        />
        {keyRequired && (
          <Input
            label="Setup key"
            value={form.key}
            onChange={(key) => setForm({ ...form, key })}
            hint="DEV_PORTAL_SETUP_KEY, from the server's environment."
          />
        )}
        <button
          onClick={() => claim.mutate()}
          disabled={claim.isPending}
          className="btn-primary w-full"
        >
          {claim.isPending ? <Spinner /> : <KeyRound className="h-4 w-4" />} Claim it
        </button>
      </div>
    </div>
  );
}

function PortalLogin({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState<string | null>(null);

  const signIn = useMutation({
    mutationFn: () => apiPost("/portal/login", form),
    onSuccess: onDone,
    onError: (loginError: Error) => setError(loginError.message),
  });

  return (
    <div className="card-pad">
      <h1 className="text-lg font-bold text-gray-900">Dev sign-in</h1>
      <p className="mt-1 text-sm text-gray-500">
        For the people who maintain Eagle Bot. Academy accounts don't work here.
      </p>
      <form
        className="mt-4 space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          signIn.mutate();
        }}
      >
        {error && <Banner tone="error">{error}</Banner>}
        <Input
          label="Email"
          type="email"
          value={form.email}
          onChange={(email) => setForm({ ...form, email })}
        />
        <Input
          label="Password"
          type="password"
          value={form.password}
          onChange={(password) => setForm({ ...form, password })}
        />
        <button type="submit" disabled={signIn.isPending} className="btn-primary w-full">
          {signIn.isPending && <Spinner />} Sign in
        </button>
      </form>
    </div>
  );
}

function AcceptInvite({ token, onDone }: { token: string; onDone: () => void }) {
  const [form, setForm] = useState({ name: "", password: "" });
  const [error, setError] = useState<string | null>(null);

  const invite = useQuery<{ email: string; name: string | null }>({
    queryKey: ["portal-invite", token],
    queryFn: () => apiGet(`/portal/invites/${token}`),
    retry: false,
  });

  const accept = useMutation({
    mutationFn: () => apiPost(`/portal/invites/${token}`, form),
    onSuccess: onDone,
    onError: (acceptError: Error) => setError(acceptError.message),
  });

  if (invite.isLoading) return <LoadingPage label="Checking that invite..." />;
  if (invite.error) {
    return (
      <div className="card-pad">
        <Banner tone="error">{(invite.error as Error).message}</Banner>
      </div>
    );
  }

  return (
    <div className="card-pad">
      <h1 className="text-lg font-bold text-gray-900">Join the dev portal</h1>
      <p className="mt-1 text-sm text-gray-500">Invited as {invite.data!.email}.</p>
      <div className="mt-4 space-y-3">
        {error && <Banner tone="error">{error}</Banner>}
        <Input label="Name" value={form.name} onChange={(name) => setForm({ ...form, name })} />
        <Input
          label="Password"
          type="password"
          value={form.password}
          onChange={(password) => setForm({ ...form, password })}
          hint="At least 10 characters."
        />
        <button
          onClick={() => accept.mutate()}
          disabled={accept.isPending}
          className="btn-primary w-full"
        >
          {accept.isPending && <Spinner />} Join
        </button>
      </div>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  type = "text",
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  hint?: string;
}) {
  return (
    <div>
      <label className="label" htmlFor={`field-${label}`}>
        {label}
      </label>
      <input
        id={`field-${label}`}
        type={type}
        className="input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

/* --------------------------------- the portal ----------------------------- */

type PortalTacon = {
  id: number;
  slug: string;
  name: string;
  tagline: string | null;
  official: boolean;
  visibility: string;
  authorName: string;
  installCount: number;
  suspendedReason: string | null;
  version: string | null;
  source: string;
  academies: number;
};

function PortalHome({
  dev,
  onSignedOut,
}: {
  dev: { name: string; head: boolean };
  onSignedOut: () => void;
}) {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [tab, setTab] = useState<"tacons" | "notices" | "devs">("tacons");

  const signOut = useMutation({
    mutationFn: () => apiPost("/portal/logout"),
    onSuccess: onSignedOut,
  });

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100">
      <header className="border-b border-gray-800 px-5 py-3">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
          <Terminal className="h-5 w-5" />
          <span className="font-bold tracking-tight">Dev portal</span>
          <span className="text-sm text-gray-400">
            {dev.name}
            {dev.head && " · head dev"}
          </span>
          <div className="ml-auto flex gap-2">
            <button onClick={() => navigate("/")} className="btn-ghost text-sm text-gray-300">
              Eagle Bot
            </button>
            <button
              onClick={() => signOut.mutate()}
              className="btn-ghost text-sm text-gray-300"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-5 py-6">
        <div className="mb-5 flex gap-2">
          {(
            [
              ["tacons", "Tac-Ons", Rocket],
              ["notices", "Notices", Megaphone],
              ["devs", "Devs", Users],
            ] as const
          ).map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`chip ${tab === key ? "bg-brand-600 text-white" : "bg-gray-800 text-gray-300"}`}
            >
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>

        {tab === "tacons" && <PortalTacons head={dev.head} queryClient={queryClient} />}
        {tab === "notices" && <PortalNotices />}
        {tab === "devs" && <PortalDevs head={dev.head} />}
      </div>
    </div>
  );
}

function PortalTacons({
  head,
  queryClient,
}: {
  head: boolean;
  queryClient: ReturnType<typeof useQueryClient>;
}) {
  const [publishing, setPublishing] = useState(false);
  const query = useQuery<{ tacons: PortalTacon[] }>({
    queryKey: ["portal-tacons"],
    queryFn: () => apiGet("/portal/tacons"),
  });

  const suspend = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string | null }) =>
      apiPost(`/portal/tacons/${id}/suspend`, { reason }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["portal-tacons"] }),
  });

  if (query.isLoading) return <LoadingPage label="Loading the registry..." />;

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold">Everything in the registry</h2>
        <button onClick={() => setPublishing(true)} className="btn-primary">
          <BadgeCheck className="h-4 w-4" /> Publish official
        </button>
      </div>

      <div className="space-y-2">
        {(query.data?.tacons ?? []).map((tacon) => (
          <div
            key={tacon.id}
            className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-800 bg-gray-850 p-3"
            style={{ background: "#111827" }}
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{tacon.name}</span>
                <span className="text-xs text-gray-500">{tacon.slug}</span>
                {tacon.official && <Chip tone="purple">official</Chip>}
                {tacon.suspendedReason && <Chip tone="red">pulled</Chip>}
              </div>
              <p className="truncate text-sm text-gray-400">{tacon.tagline}</p>
              <p className="text-xs text-gray-500">
                {tacon.authorName} · {tacon.version ?? "unpublished"} · {tacon.installCount} installs
                across {tacon.academies} academ{tacon.academies === 1 ? "y" : "ies"}
              </p>
            </div>
            {head && (
              <button
                onClick={() => {
                  if (tacon.suspendedReason) {
                    suspend.mutate({ id: tacon.id, reason: null });
                    return;
                  }
                  const reason = window.prompt(
                    "Why is this being pulled? Existing installs keep working; nobody new can install it.",
                  );
                  if (reason) suspend.mutate({ id: tacon.id, reason });
                }}
                className="btn-secondary btn-sm"
              >
                <Ban className="h-3.5 w-3.5" />
                {tacon.suspendedReason ? "Restore" : "Pull"}
              </button>
            )}
          </div>
        ))}
      </div>

      {publishing && (
        <PublishOfficial
          onClose={() => setPublishing(false)}
          onDone={() => {
            setPublishing(false);
            void queryClient.invalidateQueries({ queryKey: ["portal-tacons"] });
          }}
        />
      )}
    </>
  );
}

function PublishOfficial({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [source, setSource] = useState("");
  const [tagline, setTagline] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  const checked = compile(source || "tacon placeholder { }");
  const diagnostics: Diagnostic[] = source ? checked.diagnostics : [];

  const publish = useMutation({
    mutationFn: () => apiPost("/portal/tacons/publish", { source, tagline, description }),
    onSuccess: onDone,
    onError: (publishError: Error) => setError(publishError.message),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-[6vh]">
      <div className="card w-full max-w-3xl">
        <div className="border-b border-gray-200 p-5">
          <h2 className="text-lg font-bold text-gray-900">Publish an official Tac-On</h2>
          <p className="mt-1 text-sm text-gray-500">
            Same compiler, same rules as any academy's. It just carries the badge.
          </p>
        </div>
        <div className="max-h-[65vh] space-y-4 overflow-y-auto p-5">
          {error && <Banner tone="error">{error}</Banner>}
          {source && !checked.ok && (
            <Banner tone="warning" title="Doesn't compile yet">
              <ul className="mt-1 space-y-0.5 text-xs">
                {diagnostics
                  .filter((entry) => entry.severity === "error")
                  .map((entry, index) => (
                    <li key={index}>
                      Line {entry.line}: {entry.message}
                    </li>
                  ))}
              </ul>
            </Banner>
          )}
          <div>
            <label className="label" htmlFor="official-source">
              Source
            </label>
            <textarea
              id="official-source"
              className="input min-h-[300px] font-mono text-[13px]"
              spellCheck={false}
              value={source}
              onChange={(event) => setSource(event.target.value)}
              placeholder={"tacon my-tacon {\n  name \"My Tac-On\"\n  version 1.0.0\n}"}
            />
          </div>
          <div>
            <label className="label" htmlFor="official-tagline">
              Blurb
            </label>
            <input
              id="official-tagline"
              className="input"
              value={tagline}
              onChange={(event) => setTagline(event.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="official-description">
              Details (markdown)
            </label>
            <textarea
              id="official-description"
              className="input min-h-[100px]"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-200 bg-gray-50 p-4">
          <button onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button
            onClick={() => publish.mutate()}
            disabled={publish.isPending || !source || !checked.ok}
            className="btn-primary"
          >
            {publish.isPending && <Spinner />} Publish
          </button>
        </div>
      </div>
    </div>
  );
}

type Notice = {
  id: number;
  title: string;
  body: string;
  tone: string;
  audience: string;
  active: boolean;
  createdAt: string;
};

function PortalNotices() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ title: "", body: "", tone: "info", audience: "admins" });
  const [error, setError] = useState<string | null>(null);

  const query = useQuery<{ notices: Notice[] }>({
    queryKey: ["portal-notices"],
    queryFn: () => apiGet("/portal/notices"),
  });

  const send = useMutation({
    mutationFn: () => apiPost("/portal/notices", form),
    onSuccess: () => {
      setForm({ title: "", body: "", tone: "info", audience: "admins" });
      void queryClient.invalidateQueries({ queryKey: ["portal-notices"] });
    },
    onError: (sendError: Error) => setError(sendError.message),
  });

  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) =>
      apiPatch(`/portal/notices/${id}`, { active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["portal-notices"] }),
  });

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="card-pad">
        <h2 className="font-semibold text-gray-900">Send a notice</h2>
        <p className="hint">Every academy on this Eagle Bot sees it until you turn it off.</p>
        <div className="mt-3 space-y-3">
          {error && <Banner tone="error">{error}</Banner>}
          <Input label="Title" value={form.title} onChange={(title) => setForm({ ...form, title })} />
          <div>
            <label className="label" htmlFor="notice-body">
              Notice
            </label>
            <textarea
              id="notice-body"
              className="input min-h-[100px]"
              value={form.body}
              onChange={(event) => setForm({ ...form, body: event.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="notice-tone">
                Tone
              </label>
              <select
                id="notice-tone"
                className="input"
                value={form.tone}
                onChange={(event) => setForm({ ...form, tone: event.target.value })}
              >
                <option value="info">Info</option>
                <option value="warning">Warning</option>
                <option value="release">Release</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="notice-audience">
                Who sees it
              </label>
              <select
                id="notice-audience"
                className="input"
                value={form.audience}
                onChange={(event) => setForm({ ...form, audience: event.target.value })}
              >
                <option value="admins">Admins</option>
                <option value="devs">Devs</option>
                <option value="everyone">Everyone</option>
              </select>
            </div>
          </div>
          <button
            onClick={() => send.mutate()}
            disabled={send.isPending || form.title.length < 3 || form.body.length < 3}
            className="btn-primary w-full"
          >
            {send.isPending ? <Spinner /> : <Bell className="h-4 w-4" />} Send it
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {(query.data?.notices ?? []).map((notice) => (
          <div key={notice.id} className="card-pad">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-gray-900">{notice.title}</h3>
                <p className="mt-1 text-sm text-gray-600">{notice.body}</p>
                <div className="mt-2 flex gap-1.5">
                  <Chip>{notice.tone}</Chip>
                  <Chip>{notice.audience}</Chip>
                </div>
              </div>
              <button
                onClick={() => toggle.mutate({ id: notice.id, active: !notice.active })}
                className="btn-secondary btn-sm shrink-0"
              >
                {notice.active ? "Take down" : "Put back"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PortalDevs({ head }: { head: boolean }) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useQuery<{
    devs: { id: number; name: string; email: string; head: boolean; active: boolean }[];
    invites: { id: number; email: string; token: string; expiresAt: string }[];
  }>({
    queryKey: ["portal-devs"],
    queryFn: () => apiGet("/portal/devs"),
  });

  const invite = useMutation({
    mutationFn: () => apiPost<{ link: string }>("/portal/invites", { email }),
    onSuccess: (result) => {
      setLink(result.link);
      setEmail("");
      void queryClient.invalidateQueries({ queryKey: ["portal-devs"] });
    },
    onError: (inviteError: Error) => setError(inviteError.message),
  });

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="card-pad">
        <h2 className="font-semibold text-gray-900">Portal devs</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {(query.data?.devs ?? []).map((dev) => (
            <li key={dev.id} className="flex items-center justify-between gap-2">
              <span className="text-gray-800">
                {dev.name} <span className="text-gray-500">{dev.email}</span>
              </span>
              {dev.head && <Chip tone="purple">head</Chip>}
            </li>
          ))}
        </ul>
      </div>

      {head && (
        <div className="card-pad">
          <h2 className="font-semibold text-gray-900">Invite a dev</h2>
          <p className="hint">
            The portal has no mailer of its own. Copy the link and send it however you normally
            would.
          </p>
          <div className="mt-3 space-y-3">
            {error && <Banner tone="error">{error}</Banner>}
            <Input label="Email" type="email" value={email} onChange={setEmail} />
            <button
              onClick={() => invite.mutate()}
              disabled={invite.isPending || !email.includes("@")}
              className="btn-primary w-full"
            >
              {invite.isPending && <Spinner />} Create invite
            </button>
            {link && (
              <Banner tone="success" title="Invite link">
                <code className="break-all text-xs">{link}</code>
              </Banner>
            )}
            {(query.data?.invites ?? []).length > 0 && (
              <div className="text-xs text-gray-500">
                {query.data!.invites.length} invite
                {query.data!.invites.length === 1 ? "" : "s"} still open.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
