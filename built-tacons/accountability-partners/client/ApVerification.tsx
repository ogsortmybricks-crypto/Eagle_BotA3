import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api";
import { Banner, LoadingPage } from "@/components/ui";
import type { ApPublicCertificate } from "../shared/workspace";

export function ApVerification({ token: suppliedToken }: { token?: string }) {
  const token = suppliedToken;
  const [result, setResult] = useState<{ token: string; certificate: ApPublicCertificate | null; error: boolean } | null>(null);

  useEffect(() => {
    if (!token) {
      setResult(null);
      return;
    }
    let current = true;
    setResult({ token, certificate: null, error: false });
    apiGet<ApPublicCertificate>(`/ap/verify/${encodeURIComponent(token)}`)
      .then((certificate) => current && setResult({ token, certificate, error: false }))
      .catch(() => current && setResult({ token, certificate: null, error: true }));
    return () => { current = false; };
  }, [token]);

  useEffect(() => {
    const previousTitle = document.title;
    const existing = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    const meta = existing ?? document.createElement("meta");
    if (!existing) {
      meta.name = "robots";
      document.head.append(meta);
    }
    const previousContent = meta.content;
    meta.content = "noindex, nofollow";
    return () => {
      document.title = previousTitle;
      if (existing) meta.content = previousContent;
      else meta.remove();
    };
  }, []);

  const certificate = result && result.token === token ? result.certificate : null;
  const error = Boolean(result && result.token === token && result.error);
  if (!token || error) {
    return <main className="min-h-[100dvh] bg-amber-50 px-5 py-16"><div className="mx-auto max-w-xl rounded-2xl border border-amber-200 bg-white p-8 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[.18em] text-amber-800">Acton learning record</p>
      <h1 className="mt-3 text-3xl font-bold text-slate-900">Record not found</h1>
      <p className="mt-3 text-slate-600">This verification link is invalid or no longer available.</p>
    </div></main>;
  }
  if (!certificate) return <LoadingPage label="Verifying learning record..." />;

  return <main className="min-h-[100dvh] bg-amber-50 px-5 py-12 sm:py-20">
    <article className="mx-auto max-w-2xl overflow-hidden rounded-3xl border border-amber-200 bg-[#fffdf8] shadow-xl shadow-amber-950/5">
      <header className="bg-[#243d37] px-7 py-8 text-white sm:px-10">
        <p className="text-xs font-semibold uppercase tracking-[.2em] text-amber-200">Acton learning record</p>
        <h1 className="mt-5 text-3xl font-semibold leading-tight sm:text-4xl">Work reviewed. Learning made visible.</h1>
        <p className="mt-3 text-sm text-emerald-50/80">A public confirmation of a partner-reviewed assignment.</p>
      </header>
      <div className="p-7 sm:p-10">
        {certificate.revoked && <Banner tone="error" title="Certificate revoked">This record is no longer an active certification.</Banner>}
        <p className="mt-5 text-2xl font-semibold text-slate-900">{certificate.learnerName}</p>
        <p className="mt-1 text-slate-600">{certificate.assignmentTitle} <span className="text-slate-400">·</span> {certificate.category}</p>
        <div className={`mt-7 rounded-2xl border p-5 ${certificate.excellence ? "border-amber-300 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
          <p className="font-semibold text-slate-900">{certificate.excellence ? "Reviewed and certified with excellence" : "Reviewed and certified as completed"}</p>
          <p className="mt-1 text-sm text-slate-600">Completed {new Date(`${certificate.completedDate}T12:00:00`).toLocaleDateString()} · week of {new Date(`${certificate.week}T12:00:00`).toLocaleDateString()}</p>
        </div>
        <dl className="mt-7 grid gap-5 sm:grid-cols-2">
          <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Accountability partner</dt><dd className="mt-1 font-medium text-slate-900">{certificate.checkerName}</dd></div>
          <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Certified</dt><dd className="mt-1 font-medium text-slate-900">{new Date(certificate.certifiedAt).toLocaleDateString()}</dd></div>
        </dl>
        <footer className="mt-10 border-t border-amber-100 pt-5 text-sm text-slate-500">{certificate.academyName}</footer>
      </div>
    </article>
  </main>;
}
