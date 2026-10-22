/** Keyset pagination cursor: "createdAt|id", base64url. Stable while new rows arrive. */
export type Cursor = { t: string; id: string } | null;
export function parseCursor(raw: unknown): Cursor {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const [t, id] = Buffer.from(raw, "base64url").toString().split("|");
    if (!t || !id || Number.isNaN(Date.parse(t)) || !/^[0-9a-f-]{36}$/.test(id)) return null;
    return { t, id };
  } catch { return null; }
}
export const makeCursor = (t: Date | string, id: string) => Buffer.from(`${new Date(t).toISOString()}|${id}`).toString("base64url");
