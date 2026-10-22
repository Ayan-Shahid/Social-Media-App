// End-to-end encryption for direct messages, using libsodium (audited, widely used).
//
//  - Each user has an X25519 key pair, made in their browser when they sign up.
//  - The public key goes to the server so others can encrypt to them.
//  - The private key never leaves the browser unencrypted. A backup is stored on the server,
//    encrypted with a key derived from the user's password (Argon2id), so they can log in on another device.
//  - Messages use crypto_box (X25519 + XSalsa20-Poly1305): only the two people in the chat can read
//    them, and any tampering is detected.
//
// Limits (the full Signal protocol solves these, at much higher complexity):
//  no forward secrecy (one key pair per user), and resetting a forgotten password would lose old messages.
import _sodium from "libsodium-wrappers-sumo";
import type { KeyBackup } from "./types";

let ready: Promise<typeof _sodium> | null = null;
export const sodium = () => (ready ??= _sodium.ready.then(() => _sodium));

const B64 = () => _sodium.base64_variants.ORIGINAL;
const enc = (x: Uint8Array) => _sodium.to_base64(x, B64());
const dec = (s: string) => _sodium.from_base64(s, B64());

export async function createKeys(password: string) {
  const s = await sodium();
  const kp = s.crypto_box_keypair();
  const salt = s.randombytes_buf(s.crypto_pwhash_SALTBYTES);
  const opsLimit = s.crypto_pwhash_OPSLIMIT_INTERACTIVE;
  const memLimit = s.crypto_pwhash_MEMLIMIT_INTERACTIVE;
  const wrapKey = s.crypto_pwhash(s.crypto_secretbox_KEYBYTES, password, salt, opsLimit, memLimit, s.crypto_pwhash_ALG_ARGON2ID13);
  const nonce = s.randombytes_buf(s.crypto_secretbox_NONCEBYTES);
  const ciphertext = s.crypto_secretbox_easy(kp.privateKey, nonce, wrapKey);
  return {
    privateKey: kp.privateKey,
    upload: { publicKey: enc(kp.publicKey), backup: { ciphertext: enc(ciphertext), nonce: enc(nonce), salt: enc(salt), opsLimit, memLimit } },
  };
}

/** Unlocks the private key backup with the password. Throws if the password is wrong. */
export async function unlockBackup(b: KeyBackup, password: string): Promise<Uint8Array> {
  const s = await sodium();
  const wrapKey = s.crypto_pwhash(s.crypto_secretbox_KEYBYTES, password, dec(b.salt), b.opsLimit, b.memLimit, s.crypto_pwhash_ALG_ARGON2ID13);
  return s.crypto_secretbox_open_easy(dec(b.ciphertext), dec(b.nonce), wrapKey);
}

export async function encryptMessage(text: string, theirPublicKey: string, myPrivateKey: Uint8Array) {
  const s = await sodium();
  const nonce = s.randombytes_buf(s.crypto_box_NONCEBYTES);
  const ct = s.crypto_box_easy(text, nonce, dec(theirPublicKey), myPrivateKey);
  return { ciphertext: enc(ct), nonce: enc(nonce) };
}

/** Works for both directions: the shared key from (their public, my private) is the same either way. */
export async function decryptMessage(m: { ciphertext: string; nonce: string }, theirPublicKey: string, myPrivateKey: Uint8Array): Promise<string | null> {
  const s = await sodium();
  try { return s.to_string(s.crypto_box_open_easy(dec(m.ciphertext), dec(m.nonce), dec(theirPublicKey), myPrivateKey)); }
  catch { return null; }
}

/** A short code both people can compare to confirm no one swapped the keys in between. */
export async function safetyCode(myPublicKey: string, theirPublicKey: string) {
  const s = await sodium();
  const [a, b] = [myPublicKey, theirPublicKey].sort();
  const h: Uint8Array = s.crypto_generichash(15, s.from_string(`${a}|${b}`), null);
  const digits = Array.from(h, (x) => (x % 100).toString().padStart(2, "0")).join("");
  return digits.match(/.{5}/g)!.join(" ");
}

export async function publicKeyFromPrivate(privateKey: Uint8Array) {
  const s = await sodium();
  return enc(s.crypto_scalarmult_base(privateKey));
}

// ---------- Group chats (DECISIONS.md D7) ----------
// One random symmetric key per epoch. It's "wrapped" (crypto_box) for each member with their public
// key, by whoever starts the epoch. Messages use crypto_secretbox with the epoch's key.

export async function newGroupKey() {
  const s = await sodium();
  return s.crypto_secretbox_keygen();
}

export async function wrapGroupKey(groupKey: Uint8Array, members: { userId: string; publicKey: string }[], myPrivateKey: Uint8Array) {
  const s = await sodium();
  return members.map((m) => {
    const nonce = s.randombytes_buf(s.crypto_box_NONCEBYTES);
    return { userId: m.userId, wrappedKey: enc(s.crypto_box_easy(groupKey, nonce, dec(m.publicKey), myPrivateKey)), nonce: enc(nonce) };
  });
}

export async function unwrapGroupKey(w: { wrappedKey: string; nonce: string }, wrapperPublicKey: string, myPrivateKey: Uint8Array) {
  const s = await sodium();
  try { return s.crypto_box_open_easy(dec(w.wrappedKey), dec(w.nonce), dec(wrapperPublicKey), myPrivateKey); }
  catch { return null; }
}

export async function encryptGroup(text: string, key: Uint8Array) {
  const s = await sodium();
  const nonce = s.randombytes_buf(s.crypto_secretbox_NONCEBYTES);
  return { ciphertext: enc(s.crypto_secretbox_easy(text, nonce, key)), nonce: enc(nonce) };
}

export async function decryptGroup(m: { ciphertext: string; nonce: string }, key: Uint8Array) {
  const s = await sodium();
  try { return s.to_string(s.crypto_secretbox_open_easy(dec(m.ciphertext), dec(m.nonce), key)); }
  catch { return null; }
}
