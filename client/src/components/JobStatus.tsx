import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Sparkles, XCircle } from "lucide-react";
import { apiGet } from "@/lib/api";
import { Spinner } from "./ui";

export type Job = {
  id: number;
  kind: string;
  status: "queued" | "running" | "awaiting_input" | "succeeded" | "failed";
  message: string | null;
  progress: number;
  error: string | null;
  awaitingReason: string | null;
  result: Record<string, unknown> | null;
  inputTokens: number | null;
  outputTokens: number | null;
  finishedAt: string | null;
};

const ACTIVE = new Set(["queued", "running"]);

/** Polls one AI job until it stops moving. */
export function useJob(jobId: number | null) {
  return useQuery<{ job: Job | null }>({
    queryKey: ["job", jobId],
    queryFn: () => apiGet(`/admin/jobs/${jobId}`),
    enabled: jobId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.job?.status;
      return status && ACTIVE.has(status) ? 1500 : false;
    },
  });
}

export function JobProgress({ job }: { job: Job }) {
  if (ACTIVE.has(job.status)) {
    return (
      <div className="card-pad">
        <div className="flex items-center gap-3">
          <div className="rounded-full bg-brand-100 p-2 pulse-ring">
            <Sparkles className="h-4 w-4 text-brand-600" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              <Spinner className="h-3.5 w-3.5" />
              {job.message || "Working..."}
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full rounded-full bg-brand-500 transition-all duration-500"
                style={{ width: `${Math.max(5, job.progress)}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-gray-500">
              Claude is reading carefully — this usually takes a minute or two. You can leave this
              page; it keeps running.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (job.status === "failed") {
    return (
      <div className="card-pad border-red-200 bg-red-50">
        <div className="flex gap-3">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
          <div>
            <div className="text-sm font-semibold text-red-900">The AI run didn't finish</div>
            <p className="mt-1 text-sm text-red-800">{job.error}</p>
            <p className="mt-1.5 text-xs text-red-700">
              Nothing partial was left behind — the wiki is exactly as it was.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (job.status === "awaiting_input") {
    return (
      <div className="card-pad border-amber-200 bg-amber-50">
        <div className="flex gap-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div>
            <div className="text-sm font-semibold text-amber-900">The AI needs a decision</div>
            <p className="mt-1 text-sm text-amber-800">{job.awaitingReason}</p>
            {job.message && <p className="mt-1 text-xs text-amber-700">{job.message}</p>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card-pad border-emerald-200 bg-emerald-50">
      <div className="flex gap-3">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
        <div>
          <div className="text-sm font-semibold text-emerald-900">Done</div>
          <p className="mt-1 text-sm text-emerald-800">{job.message}</p>
        </div>
      </div>
    </div>
  );
}
