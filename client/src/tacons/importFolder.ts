/** Reads a Tac-On package without uploading or executing unrelated files. */
export type PackageFile = {
  name: string;
  size: number;
  webkitRelativePath?: string;
  text(): Promise<string>;
};

export type ImportedTacon = {
  source: string;
  sourcePath: string;
  folderName: string;
  ignoredFiles: number;
};

export const MAX_TACON_SOURCE_BYTES = 200_000;
const IGNORED_DIRECTORIES = new Set(["node_modules", ".git", "dist", ".local", ".agents"]);

export async function importTaconFolder(files: Iterable<PackageFile>): Promise<ImportedTacon> {
  const selected = Array.from(files);
  if (selected.length === 0) throw new Error("Choose a folder containing a .tacon file.");
  if (selected.length > 1000) throw new Error("That folder has too many files. Choose the Tac-On's own folder, not the whole project.");
  const sources = selected.filter((file) => {
    const path = file.webkitRelativePath || file.name;
    const parts = path.replace(/\\/g, "/").split("/");
    return !parts.slice(0, -1).some((part) => IGNORED_DIRECTORIES.has(part)) &&
      file.name.toLowerCase().endsWith(".tacon");
  });
  if (sources.length === 0) {
    throw new Error("No .tacon file was found. Choose the folder containing the Tac-On source, not its README or a ZIP file.");
  }
  if (sources.length > 1) {
    throw new Error(`Found ${sources.length} .tacon files. Choose a folder with only one Tac-On, or select the intended .tacon file instead.`);
  }
  const file = sources[0];
  if (file.size > MAX_TACON_SOURCE_BYTES) throw new Error("The .tacon file is too large. The limit is 200 KB.");
  let raw: string;
  try { raw = await file.text(); }
  catch { throw new Error(`Couldn't read ${file.name}. Try selecting the folder again.`); }
  const source = raw.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  if (source.includes("\0")) throw new Error("The .tacon file must be a plain UTF-8 text file, not a binary document.");
  if (!source.trim()) throw new Error("The .tacon file is empty.");
  if (source.length > MAX_TACON_SOURCE_BYTES || new TextEncoder().encode(source).length > MAX_TACON_SOURCE_BYTES) {
    throw new Error("The .tacon file is too large. The limit is 200 KB.");
  }
  const sourcePath = file.webkitRelativePath || file.name;
  return {
    source,
    sourcePath,
    folderName: sourcePath.includes("/") ? sourcePath.split("/")[0] : file.name,
    ignoredFiles: selected.length - 1,
  };
}