// Sign in with Google: OpenID Connect, authorization code flow with PKCE (DECISIONS.md D6).
//
//  /start:    random state + nonce + PKCE verifier, kept in Redis for 10 min (keyed by state) and the
//             state also in an httpOnly cookie, so the callback must come back to the SAME browser.
//  /callback: state must match the cookie and Redis (single use), the code is exchanged together with
//             the PKCE verifier, and the ID token is verified: signature (Google's published keys),
//             issuer, audience, expiry and nonce.
import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { config } from "../config.js";
import { redis } from "../infra/redis.js";
import { HttpError } from "../lib/http.js";

interface Discovery { issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string }
let discovery: Promise<Discovery> | null = null;
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

export const googleEnabled = () => !!config.GOOGLE_CLIENT_ID;
export const redirectUri = () => `${config.APP_ORIGIN.replace(/\/$/, "")}/api/auth/google/callback`;

async function getDiscovery(): Promise<Discovery> {
  discovery ??= fetch(`${config.GOOGLE_ISSUER.replace(/\/$/, "")}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(5000) })
    .then((r) => { if (!r.ok) throw new Error(`discovery ${r.status}`); return r.json() as Promise<Discovery>; })
    .catch((e) => { discovery = null; throw e; });
  return discovery;
}

const b64url = (b: Buffer) => b.toString("base64url");

export async function startLogin(next: string) {
  const d = await getDiscovery();
  const state = b64url(randomBytes(24));
  const nonce = b64url(randomBytes(24));
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  await redis.set(`oauth:${state}`, JSON.stringify({ nonce, verifier, next }), "EX", 600);
  const url = new URL(d.authorization_endpoint);
  url.search = new URLSearchParams({
    client_id: config.GOOGLE_CLIENT_ID, redirect_uri: redirectUri(), response_type: "code", scope: "openid email profile",
    state, nonce, code_challenge: challenge, code_challenge_method: "S256", prompt: "select_account",
  }).toString();
  return { url: url.toString(), state };
}

export interface GoogleIdentity { sub: string; email: string | null; emailVerified: boolean; name: string | null; next: string }

export async function finishLogin(code: string, state: string, cookieState: string | undefined): Promise<GoogleIdentity> {
  if (!cookieState || cookieState !== state) throw new HttpError(400, "Sign-in expired or was started in another browser. Try again.");
  const saved = await redis.getdel(`oauth:${state}`); // single use: a replayed callback fails
  if (!saved) throw new HttpError(400, "Sign-in expired. Try again.");
  const { nonce, verifier, next } = JSON.parse(saved) as { nonce: string; verifier: string; next: string };
  const d = await getDiscovery();

  const tokenRes = await fetch(d.token_endpoint, {
    method: "POST", signal: AbortSignal.timeout(8000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code", code, redirect_uri: redirectUri(), code_verifier: verifier,
      client_id: config.GOOGLE_CLIENT_ID, client_secret: config.GOOGLE_CLIENT_SECRET,
    }),
  });
  if (!tokenRes.ok) throw new HttpError(400, "Google didn't accept the sign-in. Try again.");
  const { id_token: idToken } = (await tokenRes.json()) as { id_token?: string };
  if (!idToken) throw new HttpError(400, "Google didn't return an identity.");

  jwks ??= createRemoteJWKSet(new URL(d.jwks_uri));
  let payload: JWTPayload & { email?: string; email_verified?: boolean | string; name?: string; nonce?: string };
  try {
    ({ payload } = await jwtVerify(idToken, jwks, { issuer: [d.issuer, d.issuer.replace("https://", "")], audience: config.GOOGLE_CLIENT_ID }));
  } catch {
    throw new HttpError(400, "Couldn't verify the Google sign-in.");
  }
  if (payload.nonce !== nonce) throw new HttpError(400, "Couldn't verify the Google sign-in.");
  if (!payload.sub) throw new HttpError(400, "Google didn't return an account id.");
  return {
    sub: payload.sub, email: payload.email ?? null,
    emailVerified: payload.email_verified === true || payload.email_verified === "true",
    name: payload.name ?? null, next,
  };
}

/** A username suggestion from the email or name, e.g. "maya.chen@gmail.com" -> "maya.chen". */
export function usernameFrom(identity: GoogleIdentity) {
  const base = (identity.email?.split("@")[0] ?? identity.name ?? "user").toLowerCase().replace(/[^a-z0-9_.]/g, "").slice(0, 24);
  return base.length >= 3 ? base : `user${base}`;
}

export function resetGoogleCache() { discovery = null; jwks = null; }
