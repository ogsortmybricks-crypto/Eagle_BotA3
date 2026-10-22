/**
 * Publishing an official Tac-On from the dev portal: the same app package and
 * the same checks as the Dev menu, checked again by the server before the
 * Publish button unlocks, and a different badge on the listing.
 */

import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { LoaderCircle, ShieldCheck, X } from "lucide-react";
import { ApiError, apiPost } from "@/lib/api";
import { Banner, Spinner } from "@/components/ui";
import type { AppCheck, AppPackage } from "@shared/tacons";
import { AppPackagePicker } from "./AppPackagePicker";

type Props = { onClose: () => void; onDone: () => void };
type Validation = {
  ok: boolean;
  checks: AppCheck[];
  error: string | null;
  manifest: { slug: string; name: string; version: string } | null;
};

export default function PublishOfficial({ onClose, onDone }: Props) {
  const [pkg, setPkg] = useState<AppPackage | null>(null);
  const [validation, setValidation] = useState<{ pkg: AppPackage; result: Validation } | null>(null);
  const [validating, setValidating] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [tagline, setTagline] = useState("");
  const [description, setDescription] = useState("");
  const request = useRef(0);

  // Every package chosen is checked by the server too; only that answer unlocks Publish.
  useEffect(() => {
    setValidation(null);
    setValidationError(null);
    if (!pkg) return;
    const mine = ++request.current;
    setValidating(true);
    apiPost<Validation>("/portal/tacons/validate", { app: pkg })
      .then((result) => {
        if (request.current === mine) setValidation({ pkg, result });
      })
      .catch((error: Error) => {
        if (request.current === mine) setValidationError(error.message);
      })
      .finally(() => {
        if (request.current === mine) setValidating(false);
      });
  }, [pkg]);

  const publish = useMutation({
    mutationFn: () => apiPost("/portal/tacons/publish", { app: pkg, tagline: tagline || undefined, description: description || undefined }),
    onSuccess: onDone,
  });

  const server = validation && validation.pkg === pkg ? validation.result : null;
  const ready = !!pkg && !!server?.ok && !publish.isPending;
  const publishError =
    publish.error instanceof ApiError && Array.isArray(publish.error.payload?.checks)
      ? `${publish.error.message} ${(publish.error.payload!.checks as AppCheck[]).filter((check) => !check.ok).map((check) => check.message).join(" ")}`
      : (publish.error as Error | null)?.message;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/65 p-3 pt-[4vh] sm:p-6 sm:pt-[6vh]">
      <section role="dialog" aria-modal="true" aria-labelledby="official-title" className="card w-full max-w-3xl overflow-hidden">
        <header className="flex items-start gap-4 border-b border-gray-200 p-5 sm:p-6">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-700">Official registry</div>
            <h2 id="official-title" className="mt-1 text-xl font-bold text-gray-900">
              Publish a Tac-On
            </h2>
            <p className="mt-1 max-w-xl text-sm leading-5 text-gray-500">
              Choose the app's folder or its .taconapp file. It's checked here and again by the server.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close publish dialog"
            disabled={publish.isPending}
            className="rounded-lg p-2 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="max-h-[68vh] space-y-5 overflow-y-auto p-5 sm:p-6">
          {(validationError || publishError) && (
            <Banner tone="error">{publishError ?? validationError}</Banner>
          )}

          <AppPackagePicker onChange={setPkg} disabled={publish.isPending} />

          {pkg && (
            <p className="flex items-center gap-2 text-sm text-gray-600" aria-live="polite">
              {validating ? (
                <>
                  <LoaderCircle className="h-4 w-4 animate-spin" /> Checking with the server…
                </>
              ) : server?.ok ? (
                <>The server agrees: {server.manifest?.name} {server.manifest?.version} is ready to publish.</>
              ) : server ? (
                <>The server found problems: {server.checks.filter((check) => !check.ok).map((check) => check.message).join(" ")}</>
              ) : null}
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="official-tagline">
                Blurb <span className="font-normal text-gray-400">optional</span>
              </label>
              <input
                id="official-tagline"
                className="input"
                value={tagline}
                onChange={(event) => setTagline(event.target.value)}
                placeholder="A short note for academy admins"
                disabled={publish.isPending}
              />
            </div>
            <div>
              <label className="label" htmlFor="official-description">
                Details <span className="font-normal text-gray-400">optional</span>
              </label>
              <textarea
                id="official-description"
                className="input min-h-[42px]"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Markdown details for the registry"
                disabled={publish.isPending}
              />
            </div>
          </div>
        </div>

        <footer className="flex flex-col-reverse gap-2 border-t border-gray-200 bg-gray-50 p-4 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className="btn-secondary" disabled={publish.isPending}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => publish.mutate()}
            disabled={!ready}
            className="btn-primary"
            title={!server?.ok ? "The server has to pass the app first" : undefined}
          >
            {publish.isPending && <Spinner />}
            {publish.isPending ? "Publishing…" : "Publish official"}
          </button>
        </footer>
      </section>
    </div>
  );
}
