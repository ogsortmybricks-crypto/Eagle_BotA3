import { useState } from "react";
import { Feather } from "lucide-react";
import { apiPost } from "@/lib/api";
import { Banner, Spinner } from "@/components/ui";

export function Login({ academyName, logoUrl }: { academyName?: string; logoUrl?: string | null }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiPost("/auth/login", { email: email.trim(), password });
      window.location.href = "/wiki";
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Couldn't sign in.");
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-brand-50 to-white px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-7 text-center">
          {logoUrl ? (
            <img src={logoUrl} alt="" className="mx-auto mb-4 h-14 w-14 rounded-2xl object-contain" />
          ) : (
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600 shadow-lg shadow-brand-600/20">
              <Feather className="h-7 w-7 text-white" />
            </div>
          )}
          <h1 className="text-xl font-bold tracking-tight text-gray-900">
            {academyName ?? "Eagle Bot"}
          </h1>
          <p className="mt-1 text-sm text-gray-500">Sign in to the studio's record.</p>
        </div>

        <form onSubmit={submit} className="card space-y-4 p-6">
          {error && <Banner tone="error">{error}</Banner>}
          <div>
            <label className="label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              className="input"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              autoFocus
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              className="input"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          <button type="submit" disabled={busy} className="btn-primary w-full">
            {busy && <Spinner />} Sign in
          </button>
          <p className="text-center text-xs text-gray-500">
            No account yet? An admin has to invite you — Eagle Bot doesn't take open sign-ups.
          </p>
        </form>
      </div>
    </div>
  );
}
