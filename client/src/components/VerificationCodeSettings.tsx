import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import { Banner, Spinner } from "@/components/ui";

type CodeStatus = { hasCode: boolean };

export function VerificationCodeSettings() {
  const queryClient = useQueryClient();
  const [currentCode, setCurrentCode] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const status = useQuery<CodeStatus>({
    queryKey: ["verification-code"],
    queryFn: () => apiGet<CodeStatus>("/profiles/verification-code"),
  });
  const save = useMutation({
    mutationFn: () => apiPost("/profiles/verification-code", {
      code,
      ...(status.data?.hasCode ? { currentCode } : {}),
    }),
    onSuccess: async () => {
      setCode("");
      setCurrentCode("");
      setMessage({ tone: "success", text: "Your private verification code was updated." });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["verification-code"] }),
        queryClient.invalidateQueries({ queryKey: ["tacon-view"] }),
      ]);
    },
    onError: (error: Error) => setMessage({ tone: "error", text: error.message }),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    save.mutate();
  }

  return (
    <section className="card mt-5 p-5 sm:p-6" aria-labelledby="verification-code-title">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-900">
          <KeyRound className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <h2 id="verification-code-title" className="text-lg font-semibold text-gray-900">Account confirmation code</h2>
          <p className="mt-1 max-w-2xl text-sm text-gray-600">
            A private six-digit code confirms actions that require your personal confirmation, including actions in Tac-Ons. It is never displayed or recoverable.
          </p>
        </div>
      </div>
      {status.isLoading ? (
        <div className="mt-5 space-y-2" aria-label="Loading verification code settings">
          <div className="h-4 w-40 animate-pulse rounded bg-amber-100" />
          <div className="h-10 max-w-sm animate-pulse rounded-lg bg-amber-50" />
        </div>
      ) : status.isError ? (
        <div className="mt-4">
          <Banner tone="error" title="Code settings could not be loaded">
            <button type="button" className="mt-2 underline" onClick={() => void status.refetch()}>Try again</button>
          </Banner>
        </div>
      ) : (
        <form className="mt-4 space-y-3" onSubmit={submit}>
          {message && <Banner tone={message.tone}>{message.text}</Banner>}
          {status.data?.hasCode && (
            <label className="block max-w-sm text-sm">
              <span className="label">Current six-digit code</span>
              <input
                className="input"
                type="password"
                inputMode="numeric"
                autoComplete="current-password"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                value={currentCode}
                onChange={(event) => setCurrentCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                aria-describedby="verification-current-hint"
              />
              <span id="verification-current-hint" className="hint">Required before changing your existing code.</span>
            </label>
          )}
          <label className="block max-w-sm text-sm">
            <span className="label">{status.data?.hasCode ? "New six-digit code" : "Choose a six-digit code"}</span>
            <input
              className="input"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              aria-describedby="verification-code-hint"
            />
            <span id="verification-code-hint" className="hint">Use all six digits. This code cannot be viewed later.</span>
          </label>
          <button
            className="btn-primary"
            type="submit"
            disabled={save.isPending || code.length !== 6 || (status.data?.hasCode && currentCode.length !== 6)}
          >
            {save.isPending && <Spinner />}
            {status.data?.hasCode ? "Change verification code" : "Set verification code"}
          </button>
        </form>
      )}
    </section>
  );
}
