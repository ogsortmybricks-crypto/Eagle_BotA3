import mammoth from "mammoth";

const PLAIN_TEXT_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "csv",
  "tsv",
  "json",
  "yaml",
  "yml",
  "html",
  "htm",
  "xml",
  "rtf",
  "log",
]);

export const ACCEPTED_EXTENSIONS = [...PLAIN_TEXT_EXTENSIONS, "docx"].sort();

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** RTF control words carry no meaning for us; keep the literal text. */
function stripRtf(rtf: string): string {
  return rtf
    .replace(/\\'([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\par[d]?\s?/g, "\n")
    .replace(/\\tab\s?/g, "\t")
    .replace(/\{\\\*[\s\S]*?\}/g, "")
    .replace(/\\[a-z]+-?\d*\s?/gi, "")
    .replace(/[{}]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export class UnsupportedFileError extends Error {
  constructor(extension: string) {
    super(
      `Eagle Bot can't read .${extension} files. Export it as .docx, .md, .txt, .html or .rtf first — from Google Docs that's File → Download.`,
    );
    this.name = "UnsupportedFileError";
  }
}

export async function extractText(filename: string, buffer: Buffer): Promise<string> {
  const extension = (filename.split(".").pop() ?? "").toLowerCase();

  if (extension === "docx") {
    const { value } = await mammoth.extractRawText({ buffer });
    return value.replace(/\n{3,}/g, "\n\n").trim();
  }

  if (!PLAIN_TEXT_EXTENSIONS.has(extension)) {
    throw new UnsupportedFileError(extension || "unknown");
  }

  const text = buffer.toString("utf8");
  if (extension === "html" || extension === "htm" || extension === "xml") return stripHtml(text);
  if (extension === "rtf") return stripRtf(text);
  return text.replace(/\r\n/g, "\n").trim();
}
