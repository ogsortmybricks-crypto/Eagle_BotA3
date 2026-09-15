export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public payload?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * The studio every request is scoped to.
 *
 * Kept as a module-level value rather than threaded through each call: the
 * studio is a property of what the person is looking at, not of any one
 * request, and every endpoint needs it. `null` means "every studio I can see".
 */
let currentStudioId: number | null = null;

export function setApiStudio(studioId: number | null) {
  currentStudioId = studioId;
}

export function getApiStudio(): number | null {
  return currentStudioId;
}

function studioHeaders(base?: Record<string, string>): Record<string, string> {
  return { ...base, "X-Studio-Id": currentStudioId === null ? "all" : String(currentStudioId) };
}

async function handle<T>(response: Response): Promise<T> {
  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { error: text };
    }
  }
  if (!response.ok) {
    const record = (payload ?? {}) as Record<string, unknown>;
    throw new ApiError(
      response.status,
      typeof record.error === "string" ? record.error : `Request failed (${response.status})`,
      record,
    );
  }
  return payload as T;
}

export async function apiGet<T>(path: string): Promise<T> {
  return handle<T>(await fetch(`/api${path}`, { credentials: "include", headers: studioHeaders() }));
}

export async function apiSend<T>(
  path: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<T> {
  return handle<T>(
    await fetch(`/api${path}`, {
      method,
      credentials: "include",
      headers: studioHeaders(
        body === undefined ? undefined : { "Content-Type": "application/json" },
      ),
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

export const apiPost = <T,>(path: string, body?: unknown) => apiSend<T>(path, "POST", body);
export const apiPatch = <T,>(path: string, body?: unknown) => apiSend<T>(path, "PATCH", body);
export const apiDelete = <T,>(path: string) => apiSend<T>(path, "DELETE");

export async function apiUpload<T>(path: string, formData: FormData): Promise<T> {
  return handle<T>(
    await fetch(`/api${path}`, {
      method: "POST",
      credentials: "include",
      headers: studioHeaders(),
      body: formData,
    }),
  );
}

/** Reads a File into a data URL, so small images can live in Postgres. */
export function fileToDataUrl(file: File, maxBytes = 900_000): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > maxBytes) {
      reject(
        new Error(
          `That image is ${(file.size / 1024).toFixed(0)}KB. Keep it under ${Math.round(maxBytes / 1024)}KB.`,
        ),
      );
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    reader.readAsDataURL(file);
  });
}
