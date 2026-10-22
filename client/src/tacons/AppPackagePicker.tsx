/**
 * Choosing a Tac-On app to publish: a project folder, or a packaged
 * `.taconapp` file (`.eggstension` files work too - same shape).
 *
 * The folder is read and bundled on this device with the same rules the
 * server checks, so the checklist here is what publishing will say. Nothing in
 * the folder runs while it's being read.
 */

import { useEffect, useRef, useState } from "react";
import { Check, CircleAlert, FileJson, FolderOpen, LoaderCircle } from "lucide-react";
import {
  APP_FILE_EXTENSION,
  MAX_APP_FILES,
  appFilesFrom,
  bundleAppFolder,
  checkApp,
  describeAction,
  type AppCheck,
  type AppPackage,
} from "@shared/tacons";

type Picked = {
  /** Where it came from: the folder's name, or the file's. */
  from: string;
  files: string[];
  skipped: number;
  checks: AppCheck[];
  problems: string[];
  pkg: AppPackage | null;
  manifest: Record<string, unknown> | null;
};

type FileLike = { name: string; webkitRelativePath?: string; size: number; text(): Promise<string> };

export function AppPackagePicker({
  current,
  onChange,
  disabled = false,
}: {
  /** The package already published, shown until something new is chosen. */
  current?: AppPackage | null;
  /** The chosen package when it passes every check; null otherwise. */
  onChange: (pkg: AppPackage | null) => void;
  disabled?: boolean;
}) {
  const folderInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    folderInput.current?.setAttribute("webkitdirectory", "");
    folderInput.current?.setAttribute("directory", "");
  }, []);

  const finish = (result: Picked) => {
    setPicked(result);
    onChange(result.pkg);
  };

  const readFolder = async (chosen: FileLike[]) => {
    setReading(true);
    setError(null);
    try {
      // Paths arrive as "my-app/styles/base.css"; inside the app they're "styles/base.css".
      const relative = (file: FileLike) => {
        const path = (file.webkitRelativePath || file.name).replace(/\\/g, "/");
        const parts = path.split("/");
        return parts.length > 1 ? parts.slice(1).join("/") : path;
      };
      const folder = (chosen[0]?.webkitRelativePath || "").split("/")[0] || "the folder";
      const { keep } = appFilesFrom(chosen.map(relative));
      const wanted = chosen.filter((file) => keep.includes(relative(file)));
      if (wanted.length > MAX_APP_FILES) throw new Error(`That folder has more than ${MAX_APP_FILES} app files. Choose the app's own folder.`);
      if (wanted.some((file) => file.size > 2_000_000)) throw new Error("One of the files is over 2 MB. Leave large data out of the app.");
      const files = await Promise.all(wanted.map(async (file) => ({ path: relative(file), text: await file.text() })));
      const bundled = bundleAppFolder(files);
      const result = checkApp({ manifest: bundled.manifest, html: bundled.html });
      finish({
        from: folder,
        files: files.map((file) => file.path).sort(),
        skipped: chosen.length - wanted.length,
        checks: result.checks,
        problems: bundled.problems,
        pkg: bundled.problems.length ? null : result.pkg,
        manifest: bundled.manifest && typeof bundled.manifest === "object" ? (bundled.manifest as Record<string, unknown>) : null,
      });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "That folder couldn't be read.");
      onChange(null);
    } finally {
      setReading(false);
    }
  };

  const readPackageFile = async (file: FileLike) => {
    setReading(true);
    setError(null);
    try {
      if (file.size > 3_000_000) throw new Error("That file is over 3 MB.");
      let parsed: { manifest?: unknown; html?: unknown };
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        throw new Error(`That isn't a ${APP_FILE_EXTENSION} file. It should be JSON with "manifest" and "html".`);
      }
      const html = typeof parsed.html === "string" ? parsed.html : null;
      const result = checkApp({ manifest: parsed.manifest, html });
      finish({
        from: file.name,
        files: [],
        skipped: 0,
        checks: result.checks,
        problems: [],
        pkg: result.pkg,
        manifest: parsed.manifest && typeof parsed.manifest === "object" ? (parsed.manifest as Record<string, unknown>) : null,
      });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "That file couldn't be read.");
      onChange(null);
    } finally {
      setReading(false);
    }
  };

  const shown = picked?.pkg?.manifest ?? (picked ? null : current?.manifest) ?? null;

  return (
    <section className="space-y-3">
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-gray-900">Choose the app</div>
            <p className="mt-1 max-w-xl text-xs leading-5 text-gray-600">
              A folder with <code>manifest.json</code> and <code>index.html</code> at its top, plus any CSS,
              JS and JSON it uses — or a <code>{APP_FILE_EXTENSION}</code> file exported from Eagle Bot
              (<code>.eggstension</code> files work too).
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <input
              ref={folderInput}
              type="file"
              multiple
              className="sr-only"
              aria-label="Choose the app's folder"
              onChange={(event) => {
                const files = event.currentTarget.files;
                if (files?.length) void readFolder(Array.from(files));
                event.currentTarget.value = "";
              }}
            />
            <input
              ref={fileInput}
              type="file"
              accept={`${APP_FILE_EXTENSION},.eggstension,.json,application/json`}
              className="sr-only"
              aria-label={`Choose a ${APP_FILE_EXTENSION} file`}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) void readPackageFile(file);
                event.currentTarget.value = "";
              }}
            />
            <button type="button" className="btn-primary btn-sm" disabled={disabled || reading} onClick={() => folderInput.current?.click()}>
              {reading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FolderOpen className="h-4 w-4" />} Choose folder
            </button>
            <button type="button" className="btn-secondary btn-sm" disabled={disabled || reading} onClick={() => fileInput.current?.click()}>
              <FileJson className="h-4 w-4" /> Open {APP_FILE_EXTENSION} file
            </button>
          </div>
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          {error}
        </p>
      )}

      {!picked && current && (
        <p className="text-xs text-gray-500">
          The published version is {current.manifest.version}. Choose the app again, with a higher{" "}
          <code>version</code> in its manifest, to publish the next one.
        </p>
      )}

      {picked && (
        <div className="grid gap-3 lg:grid-cols-[1fr_1.2fr]">
          <div className="space-y-3">
            <div
              className={`rounded-lg border p-3 text-sm ${
                picked.pkg ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-red-200 bg-red-50 text-red-900"
              }`}
            >
              <div className="flex items-center gap-2 font-semibold">
                {picked.pkg ? <Check className="h-4 w-4" /> : <CircleAlert className="h-4 w-4" />}
                {picked.pkg ? "Ready to publish" : "Fix these first"}
              </div>
              <ul className="mt-2 space-y-1 text-xs">
                {picked.problems.map((problem) => (
                  <li key={problem}>✗ {problem}</li>
                ))}
                {picked.checks.map((check) => (
                  <li key={check.label}>
                    {check.ok ? "✓" : "✗"} <span className="font-medium">{check.label}</span>
                    {check.message ? ` — ${check.message}` : ""}
                  </li>
                ))}
              </ul>
            </div>
            {picked.files.length > 0 && (
              <details className="rounded-lg border border-gray-200 p-3 text-xs text-gray-600">
                <summary className="cursor-pointer font-medium text-gray-800">
                  {picked.files.length} file{picked.files.length === 1 ? "" : "s"} from {picked.from}
                  {picked.skipped > 0 && ` (${picked.skipped} other file${picked.skipped === 1 ? "" : "s"} left out)`}
                </summary>
                <ul className="mt-2 space-y-0.5 font-mono">
                  {picked.files.map((file) => (
                    <li key={file}>{file}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>

          {shown && (
            <div className="rounded-lg border border-gray-200 p-3 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-2xl" aria-hidden="true">
                  {shown.icon}
                </span>
                <div className="min-w-0">
                  <div className="truncate font-semibold text-gray-900">{shown.title}</div>
                  <div className="text-xs text-gray-500">
                    {shown.name} · {shown.version} · by {shown.author}
                  </div>
                </div>
              </div>
              <p className="mt-2 text-xs text-gray-600">{shown.description}</p>
              {(shown.setup?.length ?? 0) > 0 && (
                <div className="mt-3">
                  <div className="text-xs font-semibold text-gray-700">On install</div>
                  <ul className="mt-1 space-y-1 text-xs text-gray-600">
                    {shown.setup!.map((action, index) => (
                      <li key={index}>
                        {action.optional ? "☐ Asks: " : "• "}
                        {action.prompt ?? describeAction(action)}
                        {action.optional && ` (starts ${action.default === false ? "unticked" : "ticked"})`}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
