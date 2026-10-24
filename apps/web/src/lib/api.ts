// Every call to the API goes through here. It adds the CSRF header to anything that changes data,
// and the Idempotency-Key header to "create" actions, so a double click or retry can't run twice.

export class ApiError extends Error {
  constructor(public status: number, message: string, public fields?: Record<string, string>,
    /** Extra flags from the API, e.g. { captchaRequired: true } or { retryAfter: 12 }. */
    public data: { captchaRequired?: boolean; retryAfter?: number; ref?: string; network?: boolean } = {}) { super(message); }
}

/** The request never got an answer: offline, or Glimpse unreachable. */
const offline = () => new ApiError(0, navigator.onLine === false ? "You're offline." : "Couldn't reach Glimpse.", undefined, { network: true });

/** fetch, but a network failure becomes an ApiError (status 0) like every other failure. Aborts stay aborts. */
async function send(path: string, init: RequestInit) {
  try { return await fetch(path, init); }
  catch (e) { if ((e as Error)?.name === "AbortError") throw e; throw offline(); }
}

/** A short message at the bottom of the screen (components/Notices.tsx). */
export function notice(message: string, tone: "warning" | "info" | "error" = "warning") {
  window.dispatchEvent(new CustomEvent("glimpse:notice", { detail: { message, tone } }));
}

function readCsrf() {
  const m = document.cookie.match(/(?:^|;\s*)(?:__Host-)?glimpse_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]!) : null;
}

async function ensureCsrf() {
  if (readCsrf()) return readCsrf()!;
  await send("/api/auth/csrf", { credentials: "same-origin" });
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

  let res = await send(path, { method, headers, body, credentials: "same-origin", signal: opts.signal });
  // The CSRF cookie can rotate (e.g. after logging in elsewhere). Refresh once and retry.
  if (res.status === 403 && method !== "GET") {
    const j = await res.clone().json().catch(() => ({}));
    if (/CSRF/.test(j.error ?? "")) {
      await fetch("/api/auth/csrf", { credentials: "same-origin" });
      headers["X-CSRF-Token"] = readCsrf() ?? "";
      res = await send(path, { method, headers, body, credentials: "same-origin", signal: opts.signal });
    }
  }
  const data = await res.json().catch(() => ({}));
  // Session gone (expired, logged out in another tab or device): let the app sign out everywhere.
  if (res.status === 401 && !path.startsWith("/api/auth/")) window.dispatchEvent(new Event("glimpse:unauthorized"));
  // Rate limited (DECISIONS.md D20): say so once, here, for every action. Forms show their own copy too.
  if (res.status === 429 && !path.startsWith("/api/auth/")) notice(data.error ?? "You're doing that too fast. Try again in a moment.");
  if (!res.ok) {
    const fallback = res.status >= 500 ? "Glimpse couldn't do that right now." : "Something went wrong.";
    throw new ApiError(res.status, data.error ?? fallback, data.fields, {
      captchaRequired: data.captchaRequired, retryAfter: data.retryAfter, ref: data.ref ?? res.headers.get("x-request-id") ?? undefined,
    });
  }
  return data as T;
}
