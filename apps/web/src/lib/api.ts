// Every call to the API goes through here. It adds the CSRF header to anything that changes data,
// and the Idempotency-Key header to "create" actions, so a double click or retry can't run twice.

export class ApiError extends Error {
  constructor(public status: number, message: string, public fields?: Record<string, string>) { super(message); }
}

function readCsrf() {
  const m = document.cookie.match(/(?:^|;\s*)(?:__Host-)?glimpse_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]!) : null;
}

async function ensureCsrf() {
  if (readCsrf()) return readCsrf()!;
  await fetch("/api/auth/csrf", { credentials: "same-origin" });
  return readCsrf() ?? "";
}

/** A fresh key per user action. Keep it for retries of the same action. */
export const newIdempotencyKey = () => crypto.randomUUID().replace(/-/g, "");

type Opts = { method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; body?: unknown; form?: FormData; idempotencyKey?: string; signal?: AbortSignal };

export async function api<T>(path: string, opts: Opts = {}): Promise<T> {
  const method = opts.method ?? "GET";
  const headers: Record<string, string> = {};
  if (method !== "GET") headers["X-CSRF-Token"] = await ensureCsrf();
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(opts.body); }

  let res = await fetch(path, { method, headers, body, credentials: "same-origin", signal: opts.signal });
  // The CSRF cookie can rotate (e.g. after logging in elsewhere). Refresh once and retry.
  if (res.status === 403 && method !== "GET") {
    const j = await res.clone().json().catch(() => ({}));
    if (/CSRF/.test(j.error ?? "")) {
      await fetch("/api/auth/csrf", { credentials: "same-origin" });
      headers["X-CSRF-Token"] = readCsrf() ?? "";
      res = await fetch(path, { method, headers, body, credentials: "same-origin", signal: opts.signal });
    }
  }
  const data = await res.json().catch(() => ({}));
  // Session gone (expired, logged out in another tab or device): let the app sign out everywhere.
  if (res.status === 401 && !path.startsWith("/api/auth/")) window.dispatchEvent(new Event("glimpse:unauthorized"));
  if (!res.ok) throw new ApiError(res.status, data.error ?? "Something went wrong.", data.fields);
  return data as T;
}
