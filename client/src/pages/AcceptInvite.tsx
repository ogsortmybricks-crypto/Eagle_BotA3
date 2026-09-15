import { useEffect, useState } from "react";
import { Feather } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import { applyPalette, type Palette } from "@/lib/session";
import { Banner, Chip, LoadingPage, Spinner } from "@/components/ui";

type InviteInfo = {
  email: string;
  name: string | null;
  role: string;
  studio: { name: string; description: string | null; color: string } | null;
  minPasswordLength: number;
  academy: { name?: string; palette?: Palette; logoUrl?: string | null };
};

const ROLE_BLURB: Record<string, string> = {
  admin: "You'll be able to invite people, manage the wiki, and see everything that happens.",
  secretary: "You'll take Town Hall notes and run them through the AI into the wiki.",
  guide: "You'll be able to read everything. Governance decisions stay with the studio.",
  learner: "You'll read the wiki, run for positions, and vote.",
};

export function AcceptInvite({ token }: { token: string }) {
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<InviteInfo>(`/auth/invite/${token}`)
      .then((data) => {
        setInvite(data);
        setName(data.name ?? "");
        if (data.academy.palette) applyPalette(data.academy.palette);
      })
      .catch((fetchError) =>
        setLoadError(fetchError instanceof Error ? fetchError.message : "Invalid invite."),
      );
  }, [token]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/auth/invite/${token}`, { name: name.trim(), password });
      window.location.href = "/wiki";
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Couldn't finish signing up.");
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <Banner tone="error" title="That invite won't work">
            {loadError}
            <div className="mt-2">
              <a href="/" className="font-semibold underline">
                Go to sign in
              </a>
            </div>
          </Banner>
        </div>
      </div>
    );
  }

  if (!invite) return <LoadingPage label="Checking your invite..." />;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-brand-50 to-white px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-7 text-center">
          {invite.academy.logoUrl ? (
            <img
              src={invite.academy.logoUrl}
              alt=""
              className="mx-auto mb-4 h-14 w-14 rounded-2xl object-contain"
            />
          ) : (
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600 shadow-lg shadow-brand-600/20">
              <Feather className="h-7 w-7 text-white" />
            </div>
          )}
          <h1 className="text-xl font-bold tracking-tight text-gray-900">
            Join {invite.academy.name}
          </h1>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
            <span className="text-sm text-gray-500">{invite.email}</span>
            <Chip tone="brand">{invite.role}</Chip>
            {invite.studio && (
              <span
                className="chip"
                style={{ background: `${invite.studio.color}1a`, color: invite.studio.color }}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: invite.studio.color }}
                />
                {invite.studio.name}
              </span>
            )}
          </div>
        </div>

        <form onSubmit={submit} className="card space-y-4 p-6">
          {error && <Banner tone="error">{error}</Banner>}
          <p className="text-sm text-gray-600">{ROLE_BLURB[invite.role]}</p>
          {invite.studio ? (
            <p className="text-sm text-gray-600">
              You'll be in <strong>{invite.studio.name}</strong>
              {invite.studio.description ? ` — ${invite.studio.description}` : ""} Its rules,
              meetings and elections are the ones you'll see.
            </p>
          ) : (
            <p className="text-sm text-amber-700">
              You haven't been placed in a studio yet, so there won't be much to see until an admin
              does that.
            </p>
          )}
          <div>
            <label className="label" htmlFor="name">
              Your name
            </label>
            <input
              id="name"
              className="input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="How the studio knows you"
              autoFocus
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="password">
              Choose a password
            </label>
            <input
              id="password"
              type="password"
              className="input"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={`At least ${invite.minPasswordLength} characters`}
              autoComplete="new-password"
              required
              minLength={invite.minPasswordLength}
            />
          </div>
          <button
            type="submit"
            disabled={
              busy || name.trim().length < 2 || password.length < invite.minPasswordLength
            }
            className="btn-primary w-full"
          >
            {busy && <Spinner />} Join {invite.academy.name}
          </button>
        </form>
      </div>
    </div>
  );
}
