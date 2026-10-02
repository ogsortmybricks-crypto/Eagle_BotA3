import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Check, FileCode2, FolderOpen, Info, LoaderCircle, ShieldCheck, X } from "lucide-react";
import { ApiError, apiPost } from "@/lib/api";
import { Banner, Spinner } from "@/components/ui";
import { compile, type Diagnostic } from "@shared/tacons";
import type { TaconValidation } from "@shared/tacons/validation";
import { importTaconFolder, type PackageFile } from "./importFolder";

type Props = { onClose: () => void; onDone: () => void };
type ServerResult = { source: string; result: TaconValidation };

function formatDiagnostic(diagnostic: Diagnostic) {
  return `Line ${diagnostic.line}, column ${diagnostic.column}: ${diagnostic.message}`;
}

function apiDiagnostics(error: Error): Diagnostic[] {
  if (!(error instanceof ApiError) || !error.payload) return [];
  const value = error.payload.diagnostics;
  return Array.isArray(value) ? (value as Diagnostic[]) : [];
}

export default function PublishOfficial({ onClose, onDone }: Props) {
  const folderInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);
  const selectionId = useRef(0);
  const sourceRef = useRef("");
  const [source, setSource] = useState("");
  const [sourcePath, setSourcePath] = useState("");
  const [ignoredFiles, setIgnoredFiles] = useState(0);
  const [sourceRevision, setSourceRevision] = useState(0);
  const [importPending, setImportPending] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [validation, setValidation] = useState<ServerResult | null>(null);
  const [validationPending, setValidationPending] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [tagline, setTagline] = useState("");
  const [description, setDescription] = useState("");
  const local = source.trim() ? compile(source) : null;

  useEffect(() => {
    folderInput.current?.setAttribute("webkitdirectory", "");
    folderInput.current?.setAttribute("directory", "");
  }, []);

  const updateSource = (next: string) => {
    requestId.current += 1;
    sourceRef.current = next;
    setSource(next);
    setValidation(null);
    setValidationPending(false);
    setValidationError(null);
    setImportError(null);
    publish.reset();
    setSourceRevision((revision) => revision + 1);
  };

  useEffect(() => {
    if (!source.trim() || importPending) return;
    const candidate = source;
    const timer = window.setTimeout(async () => {
      const currentRequest = ++requestId.current;
      setValidationPending(true);
      setValidationError(null);
      try {
        const result = await apiPost<TaconValidation>("/portal/tacons/validate", {
          source: candidate,
        });
        if (requestId.current !== currentRequest || sourceRef.current !== candidate) return;
        setValidation({ source: candidate, result });
      } catch (error) {
        if (requestId.current !== currentRequest || sourceRef.current !== candidate) return;
        if (error instanceof ApiError && error.status === 404) {
          setValidationError(
            "The server validation route is not available in this live portal yet. Republish the app with the latest Tac-On engine before publishing.",
          );
        } else {
          setValidationError((error as Error).message || "Server validation failed. Try again.");
        }
      } finally {
        if (requestId.current === currentRequest && sourceRef.current === candidate) {
          setValidationPending(false);
        }
      }
    }, 450);
    return () => window.clearTimeout(timer);
  }, [source, sourceRevision, importPending]);

  const publish = useMutation({
    mutationFn: () => apiPost("/portal/tacons/publish", { source, tagline, description }),
    onSuccess: onDone,
  });

  const chooseFiles = async (files: Iterable<PackageFile>) => {
    const currentSelection = ++selectionId.current;
    requestId.current += 1;
    setValidation(null);
    setValidationPending(false);
    setValidationError(null);
    setImportError(null);
    publish.reset();
    setImportPending(true);
    setSourceRevision((revision) => revision + 1);
    try {
      const imported = await importTaconFolder(files);
      if (selectionId.current !== currentSelection) return;
      sourceRef.current = imported.source;
      setSource(imported.source);
      setSourcePath(imported.sourcePath);
      setIgnoredFiles(imported.ignoredFiles);
      setTagline("");
      setImportPending(false);
      setSourceRevision((revision) => revision + 1);
    } catch (error) {
      if (selectionId.current !== currentSelection) return;
      setImportError((error as Error).message);
      setImportPending(false);
      setSourceRevision((revision) => revision + 1);
    }
  };

  const publishDiagnostics = publish.error ? apiDiagnostics(publish.error) : [];
  const serverForCurrentSource = validation?.source === source ? validation.result : null;
  const readyToPublish =
    !!source.trim() &&
    !!serverForCurrentSource?.ok &&
    !validationPending &&
    !importPending &&
    !importError &&
    !publish.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/65 p-3 pt-[4vh] sm:p-6 sm:pt-[6vh]">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="official-title"
        className="card w-full max-w-3xl overflow-hidden"
      >
        <header className="flex items-start gap-4 border-b border-gray-200 p-5 sm:p-6">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-700">
              Official registry
            </div>
            <h2 id="official-title" className="mt-1 text-xl font-bold text-gray-900">
              Publish a Tac-On
            </h2>
            <p className="mt-1 max-w-xl text-sm leading-5 text-gray-500">
              Choose the package folder. We find its single TacScript file and send only that source
              for validation and publication.
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
          {(importError || validationError || publish.error) && (
            <div className="space-y-2" role="alert">
              {importError && <Banner tone="error">{importError}</Banner>}
              {validationError && (
                <Banner tone="error" title="Could not verify this source">
                  {validationError}
                </Banner>
              )}
              {publish.error && (
                <Banner tone="error" title="Publication was not completed">
                  <p>{publish.error.message}</p>
                  {publishDiagnostics.length > 0 && (
                    <ul className="mt-2 space-y-1 text-xs">
                      {publishDiagnostics.map((diagnostic, index) => (
                        <li key={`${diagnostic.line}-${diagnostic.column}-${index}`}>
                          {formatDiagnostic(diagnostic)}
                        </li>
                      ))}
                    </ul>
                  )}
                  {publish.error instanceof ApiError &&
                    publish.error.status === 404 &&
                    "The live server may need the latest Tac-On publishing routes."}
                </Banner>
              )}
            </div>
          )}

          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                  <FolderOpen className="h-4 w-4 text-brand-700" />
                  Start with a package folder
                </div>
                <p className="mt-1 max-w-lg text-sm leading-5 text-gray-500">
                  README, tests, and other files stay on your device. Only the one .tacon source is
                  submitted.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <input
                  ref={folderInput}
                  type="file"
                  multiple
                  className="sr-only"
                  aria-label="Choose Tac-On package folder"
                  onChange={(event) => {
                    if (event.currentTarget.files?.length) {
                      void chooseFiles(Array.from(event.currentTarget.files));
                    }
                    event.currentTarget.value = "";
                  }}
                />
                <button
                  type="button"
                  onClick={() => folderInput.current?.click()}
                  disabled={publish.isPending}
                  className="btn-primary"
                >
                  {importPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FolderOpen className="h-4 w-4" />}
                  {importPending ? "Reading package…" : "Choose folder"}
                </button>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".tacon"
                  className="sr-only"
                  aria-label="Choose a .tacon source file"
                  onChange={(event) => {
                    if (event.currentTarget.files?.length) {
                      void chooseFiles(Array.from(event.currentTarget.files));
                    }
                    event.currentTarget.value = "";
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  disabled={publish.isPending}
                  className="btn-secondary"
                >
                  <FileCode2 className="h-4 w-4" /> Choose .tacon
                </button>
              </div>
            </div>

            {sourcePath && (
              <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-gray-200 pt-3 text-sm">
                <span className="font-mono text-xs text-gray-700">{sourcePath}</span>
                <span className="text-xs text-gray-500">TacScript source selected</span>
                {ignoredFiles > 0 && (
                  <span className="text-xs text-gray-500">
                    {ignoredFiles} other {ignoredFiles === 1 ? "file" : "files"} not included
                  </span>
                )}
              </div>
            )}
            {importPending && (
              <p className="mt-3 text-sm text-gray-600" role="status">
                Reading the selected source on this device…
              </p>
            )}
          </div>

          <div className="rounded-lg border border-brand-100 bg-brand-50/70 px-4 py-3 text-sm text-brand-900">
            <div className="flex gap-2">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                Tac-Ons are declarative packages, not executable plugins. This flow never sends
                arbitrary folder code or assets. Server validation is required; if a newer market
                construct is rejected by the server compiler, update the server rather than
                bypassing validation.
              </p>
            </div>
          </div>

          {source && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">Package check</h3>
                  <p className="text-xs text-gray-500">
                    Local feedback is advisory. The server compiler decides whether this version
                    can publish.
                  </p>
                </div>
                <div className="shrink-0">
                  {importPending || validationPending ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600" role="status">
                      <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> Checking
                    </span>
                  ) : serverForCurrentSource?.ok ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">
                      <Check className="h-3.5 w-3.5" /> Server verified
                    </span>
                  ) : serverForCurrentSource ? (
                    <span className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-800">
                      Needs changes
                    </span>
                  ) : (
                    <span className="rounded-full bg-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-700">
                      Awaiting server check
                    </span>
                  )}
                </div>
              </div>

              {serverForCurrentSource?.manifest && (
                <div className="grid gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 sm:grid-cols-3">
                  <Meta label="Name" value={serverForCurrentSource.manifest.name} />
                  <Meta label="Slug" value={serverForCurrentSource.manifest.slug} mono />
                  <Meta label="Version" value={serverForCurrentSource.manifest.version} mono />
                  {serverForCurrentSource.manifest.academyWide && (
                    <p className="sm:col-span-3 text-xs leading-5 text-emerald-900">
                      Academy-wide: this Tac-On is designed to be available across each academy
                      that installs it.
                    </p>
                  )}
                </div>
              )}

              {serverForCurrentSource && serverForCurrentSource.diagnostics.length > 0 && (
                <DiagnosticList
                  diagnostics={serverForCurrentSource.diagnostics}
                  title="Server compiler feedback"
                />
              )}
              {local && !local.ok && (
                <DiagnosticList
                  diagnostics={local.diagnostics}
                  title="Local compiler feedback"
                />
              )}

              <details className="rounded-xl border border-gray-200">
                <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-gray-700 marker:hidden">
                  Advanced: inspect or edit source
                </summary>
                <div className="border-t border-gray-200 p-4">
                  <label className="label" htmlFor="official-source">
                    TacScript source
                  </label>
                  <textarea
                    id="official-source"
                    className="input min-h-[250px] font-mono text-[13px] leading-5"
                    spellCheck={false}
                    value={source}
                    disabled={importPending || publish.isPending}
                    onChange={(event) => updateSource(event.target.value)}
                    aria-describedby="source-editor-hint"
                  />
                  <p id="source-editor-hint" className="hint">
                    Editing invalidates the previous server result and starts a fresh check.
                  </p>
                </div>
              </details>
            </div>
          )}

          {!source && (
            <details className="rounded-xl border border-gray-200">
              <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-gray-700 marker:hidden">
                Advanced: paste TacScript instead
              </summary>
              <div className="border-t border-gray-200 p-4">
                <label className="label" htmlFor="official-source">
                  TacScript source
                </label>
                <textarea
                  id="official-source"
                  className="input min-h-[250px] font-mono text-[13px] leading-5"
                  spellCheck={false}
                  value={source}
                  disabled={importPending || publish.isPending}
                  onChange={(event) => updateSource(event.target.value)}
                  placeholder={"tacon my-tacon {\n  name \"My Tac-On\"\n  version 1.0.0\n}"}
                  aria-describedby="source-editor-hint"
                />
                <p id="source-editor-hint" className="hint">
                  This is an alternative, not the primary package flow. Editing invalidates the
                  previous server result and starts a fresh check.
                </p>
              </div>
            </details>
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
            disabled={!readyToPublish}
            className="btn-primary"
            title={!serverForCurrentSource?.ok ? "A successful server validation is required" : undefined}
          >
            {publish.isPending && <Spinner />}
            {publish.isPending ? "Publishing…" : "Publish official"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function Meta({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-800/70">
        {label}
      </div>
      <div className={`mt-1 truncate text-sm font-semibold text-emerald-950 ${mono ? "font-mono" : ""}`}>
        {value}
      </div>
    </div>
  );
}

function DiagnosticList({ diagnostics, title }: { diagnostics: Diagnostic[]; title: string }) {
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  const warnings = diagnostics.filter((diagnostic) => diagnostic.severity === "warning");
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
      <h4 className="text-sm font-semibold text-amber-950">{title}</h4>
      <ul className="mt-2 space-y-1 text-xs leading-5 text-amber-950">
        {[...errors, ...warnings].map((diagnostic, index) => (
          <li key={`${diagnostic.line}-${diagnostic.column}-${index}`}>
            <span className="font-semibold">
              {diagnostic.severity === "error" ? "Error" : "Warning"} ·{" "}
              {formatDiagnostic(diagnostic)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}