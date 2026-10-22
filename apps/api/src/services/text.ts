// @mentions and #hashtags. Parsed on the server (the client's version is only for display).
// The client renders them by splitting text into tokens and building React elements, never HTML.
const MENTION = /(^|[^\w@])@([a-zA-Z0-9_.]{3,30})\b/g;
const HASHTAG = /(^|[^\w#&])#([\p{L}\p{N}_]{1,50})/gu;

export function extractMentions(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(MENTION)) out.add(m[2]!.toLowerCase());
  return [...out].slice(0, 20);
}

export function extractHashtags(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(HASHTAG)) out.add(m[2]!.toLowerCase());
  return [...out].slice(0, 30);
}
