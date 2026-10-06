import { useEffect, useRef, useState } from "react";
import { FileCode2, FolderOpen, LoaderCircle } from "lucide-react";
import { importTaconFolder, type ImportedTacon, type PackageFile } from "./importFolder";

type Props = {
  onReadingChange: (reading: boolean) => void;
  onImported: (result: ImportedTacon) => void;
  onImportError: (message: string) => void;
  blocked?: boolean;
};

export function TaconPackagePicker({
  onReadingChange,
  onImported,
  onImportError,
  blocked = false,
}: Props) {
  const folderInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const selection = useRef(0);
  const mounted = useRef(true);
  const [reading, setReading] = useState(false);
  const [summary, setSummary] = useState<ImportedTacon | null>(null);

  useEffect(() => {
    mounted.current = true;
    folderInput.current?.setAttribute("webkitdirectory", "");
    folderInput.current?.setAttribute("directory", "");
    return () => {
      mounted.current = false;
      selection.current += 1;
    };
  }, []);

  const select = async (files: Iterable<PackageFile>) => {
    const activeSelection = ++selection.current;
    setReading(true);
    onReadingChange(true);
    try {
      const result = await importTaconFolder(files);
      if (!mounted.current || selection.current !== activeSelection) return;
      setSummary(result);
      onImported(result);
    } catch (error) {
      if (!mounted.current || selection.current !== activeSelection) return;
      onImportError(error instanceof Error ? error.message : "Couldn't read this package. Try selecting it again.");
    } finally {
      if (mounted.current && selection.current === activeSelection) {
        setReading(false);
        onReadingChange(false);
      }
    }
  };

  return (
    <section className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <FolderOpen className="h-4 w-4 text-brand-700" />
            Upload a Tac-On package folder
          </div>
          <p className="mt-1 max-w-xl text-xs leading-5 text-gray-600">
            Only its single .tacon source is read. Other files stay on this device and are not uploaded or run.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <input
            ref={folderInput}
            type="file"
            multiple
            className="sr-only"
            aria-label="Choose Tac-On package folder"
            onChange={(event) => {
              const files = event.currentTarget.files;
              if (files?.length) void select(Array.from(files) as PackageFile[]);
              event.currentTarget.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => folderInput.current?.click()}
            disabled={blocked}
            className="btn-primary btn-sm"
          >
            {reading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FolderOpen className="h-4 w-4" />}
            {reading ? "Reading folder…" : "Choose folder"}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".tacon"
            className="sr-only"
            aria-label="Choose a single .tacon source file"
            onChange={(event) => {
              const files = event.currentTarget.files;
              if (files?.length) void select(Array.from(files) as PackageFile[]);
              event.currentTarget.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={blocked}
            className="btn-secondary btn-sm"
          >
            <FileCode2 className="h-4 w-4" /> Choose .tacon
          </button>
        </div>
      </div>
      {reading && (
        <p className="mt-3 text-xs text-gray-600" role="status">
          Reading the selected source on this device…
        </p>
      )}
      {summary && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-gray-200 pt-3 text-xs">
          <span className="font-mono text-gray-700">{summary.sourcePath}</span>
          <span className="text-gray-500">TacScript source selected</span>
          {summary.ignoredFiles > 0 && (
            <span className="text-gray-500">
              {summary.ignoredFiles} other {summary.ignoredFiles === 1 ? "file" : "files"} ignored
            </span>
          )}
        </div>
      )}
    </section>
  );
}
