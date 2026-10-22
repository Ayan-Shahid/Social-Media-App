// Upload sanitization and processing (DECISIONS.md D8, D14).
//
//  1. The browser asks for an upload slot, declaring type and size. The API checks the purpose and the
//     size limit, and signs a PUT URL that is only valid for exactly that size and type, for 10 minutes.
//  2. The browser uploads straight to private object storage. The API never handles the bytes.
//  3. On "complete", the API reads the first 4 KB and checks the real type from the magic bytes
//     (not the name, extension or declared type). HTML, SVG, scripts or an .exe renamed .png
//     are rejected right away, and the object is deleted.
//  4. A worker downloads it, decodes and re-encodes into fresh files (images -> WebP 480/1080,
//     videos -> HLS 360p/720p + poster), and writes them to the public bucket under random keys.
//     Anything hidden in the original (appended data, polyglots, metadata, GPS) doesn't survive,
//     because only decoded pixels and audio are kept.
//  5. Public files are served with nosniff, a fixed Content-Type and a sandbox CSP (Caddy), so a
//     browser can't treat one as a page.
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { fileTypeFromBuffer } from "file-type";
import { config } from "../config.js";
import { HttpError } from "../lib/http.js";
import { putPublic } from "../infra/storage.js";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"]);
const VIDEO_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm"]);

export type Purpose = "post" | "avatar" | "story" | "short";

const reject = (msg: string) => new HttpError(415, msg);

export async function detectType(buf: Buffer) {
  const t = await fileTypeFromBuffer(buf);
  if (!t) return null;
  if (IMAGE_TYPES.has(t.mime)) return { kind: "image" as const, mime: t.mime };
  if (VIDEO_TYPES.has(t.mime)) return { kind: "video" as const, mime: t.mime };
  return null;
}

const allowed = "Only photos (JPEG, PNG, WebP, GIF, HEIC) and videos (MP4, MOV, WebM) are allowed.";

/** Before upload: what the browser declares. Cheap, and stops obviously wrong uploads early. */
export function checkDeclared(mime: string, size: number, purpose: Purpose) {
  const kind = IMAGE_TYPES.has(mime) ? "image" as const : VIDEO_TYPES.has(mime) ? "video" as const : null;
  if (!kind) throw reject(allowed);
  checkKind(kind, purpose);
  const maxMb = kind === "image" ? config.MAX_IMAGE_MB : config.MAX_VIDEO_MB;
  if (size > maxMb * 1024 * 1024) throw new HttpError(413, `File too large. Max ${maxMb} MB.`);
  return kind;
}

function checkKind(kind: "image" | "video", purpose: Purpose) {
  if (kind === "video" && (purpose === "avatar")) throw reject("Profile pictures must be photos.");
  if (kind === "image" && purpose === "short") throw reject("Shorts must be videos.");
}

/** After upload: the real type, from the file's first bytes. Must match what was declared. */
export async function checkActual(head: Buffer, declaredKind: "image" | "video", purpose: Purpose) {
  const type = await detectType(head);
  if (!type) throw reject(allowed);
  if (type.kind !== declaredKind) throw reject("The file doesn't match its declared type.");
  checkKind(type.kind, purpose);
  return type;
}

/** Thrown for bad input: the job should fail immediately instead of retrying. */
export class BadMediaError extends Error {}

export interface Processed {
  variants: { src: string; srcset?: { w: number; path: string }[]; hls?: string; poster?: string };
  width: number; height: number; durationMs: number | null; bytes: number; mime: string;
}

// ---------- worker side ----------

export async function processImage(mediaId: string, input: Buffer, purpose: Purpose): Promise<Processed> {
  const widths = purpose === "avatar" ? [400] : [480, 1080];
  const srcset: { w: number; path: string }[] = [];
  let width = 0, height = 0, bytes = 0;
  try {
    for (const w of widths) {
      // limitInputPixels guards against "decompression bombs"; metadata (EXIF/GPS) is dropped by default.
      let p = sharp(input, { limitInputPixels: 50_000_000, failOn: "error", animated: false }).rotate();
      p = purpose === "avatar" ? p.resize(w, w, { fit: "cover" }) : p.resize({ width: w, height: Math.round(w * 1.91), fit: "inside", withoutEnlargement: true });
      const { data, info } = await p.webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
      const rel = `${mediaId}/${w}.webp`;
      await putPublic(rel, data);
      srcset.push({ w: info.width, path: rel });
      width = info.width; height = info.height; bytes += data.length;
    }
  } catch (e) {
    if ((e as Error).name?.includes("S3") || (e as { $metadata?: unknown }).$metadata) throw e; // storage hiccup: retry
    throw new BadMediaError("This image couldn't be read. It may be damaged or not a real image.");
  }
  return { variants: { src: srcset[srcset.length - 1]!.path, srcset }, width, height, durationMs: null, bytes, mime: "image/webp" };
}

export async function processVideo(mediaId: string, original: Buffer, purpose: Purpose): Promise<Processed> {
  // ffmpeg works on files: use a private temp folder, upload the results, then delete it.
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `glimpse-${mediaId}-`));
  try { return await transcode(mediaId, original, purpose, dir); }
  finally { await fs.rm(dir, { recursive: true, force: true }); }
}

async function transcode(mediaId: string, original: Buffer, purpose: Purpose, dir: string): Promise<Processed> {
  const input = path.join(dir, "original");
  await fs.writeFile(input, original);
  const hlsDir = path.join(dir, "hls");
  await fs.mkdir(hlsDir);

  let probe: { streams?: { codec_type?: string; width?: number; height?: number; tags?: { rotate?: string }; side_data_list?: { rotation?: number }[] }[]; format?: { duration?: string } };
  try {
    const r = await run(config.FFPROBE_PATH, ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", input], 20_000);
    probe = JSON.parse(r.stdout);
  } catch { throw new BadMediaError("This video couldn't be read. It may be damaged or not a real video."); }
  const v = probe.streams?.find((s) => s.codec_type === "video");
  const hasAudio = !!probe.streams?.some((s) => s.codec_type === "audio");
  const duration = Number(probe.format?.duration ?? 0);
  if (!v?.width || !v.height) throw new BadMediaError("This file has no video in it.");
  if (!duration || duration > config.MAX_VIDEO_SECONDS) throw new BadMediaError(`Videos can be up to ${config.MAX_VIDEO_SECONDS} seconds.`);
  if (purpose === "short" && duration > 60) throw new BadMediaError("Shorts can be up to 60 seconds.");

  // Encoding ladder: short side 360 and 720 (only what the source can fill; never upscale).
  const shortSide = Math.min(v.width, v.height);
  const ladder = [360, 720].filter((h) => h <= shortSide);
  if (!ladder.length) ladder.push(shortSide - (shortSide % 2));
  const scale = (s: number) => `scale='if(gt(iw,ih),-2,${s})':'if(gt(iw,ih),${s},-2)'`;
  const split = ladder.length > 1 ? `[0:v]split=${ladder.length}${ladder.map((_, i) => `[s${i}]`).join("")};` : `[0:v]copy[s0];`;
  const filter = split + ladder.map((h, i) => `[s${i}]${scale(h)},format=yuv420p[v${i}]`).join(";");
  const maps = ladder.flatMap((_, i) => ["-map", `[v${i}]`, ...(hasAudio ? ["-map", "0:a:0"] : [])]);
  const streamMap = ladder.map((_, i) => (hasAudio ? `v:${i},a:${i}` : `v:${i}`)).join(" ");
  try {
    await run(config.FFMPEG_PATH, [
      "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", input,
      "-filter_complex", filter, ...maps, "-map_metadata", "-1", "-sn", "-dn",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-profile:v", "main", "-g", "48", "-keyint_min", "48", "-sc_threshold", "0",
      ...(hasAudio ? ["-c:a", "aac", "-b:a", "96k", "-ac", "2"] : []),
      "-t", String(config.MAX_VIDEO_SECONDS),
      "-f", "hls", "-hls_time", "4", "-hls_playlist_type", "vod",
      "-hls_segment_filename", path.join(hlsDir, "v%v_%03d.ts"),
      "-master_pl_name", "master.m3u8", "-var_stream_map", streamMap,
      path.join(hlsDir, "v%v.m3u8"),
    ], 600_000);
  } catch (e) {
    throw new Error(`Transcode failed: ${(e as Error).message.slice(0, 200)}`); // retryable (could be resource pressure)
  }

  const posterRaw = path.join(dir, "poster.png");
  await run(config.FFMPEG_PATH, ["-nostdin", "-loglevel", "error", "-y", "-ss", "0.5", "-i", input, "-frames:v", "1", posterRaw], 30_000)
    .catch(() => run(config.FFMPEG_PATH, ["-nostdin", "-loglevel", "error", "-y", "-i", input, "-frames:v", "1", posterRaw], 30_000));
  const poster = await sharp(posterRaw).rotate().resize({ width: 1080, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer({ resolveWithObject: true });

  // Segments first, playlists last: a player never sees a playlist that points at a missing segment.
  let bytes = poster.data.length;
  const files = (await fs.readdir(hlsDir)).sort((a, b) => Number(a.endsWith(".m3u8")) - Number(b.endsWith(".m3u8")));
  for (const f of files) {
    const data = await fs.readFile(path.join(hlsDir, f));
    bytes += data.length;
    await putPublic(`${mediaId}/hls/${f}`, data);
  }
  await putPublic(`${mediaId}/poster.webp`, poster.data);
  return {
    variants: { src: `${mediaId}/poster.webp`, hls: `${mediaId}/hls/master.m3u8`, poster: `${mediaId}/poster.webp` },
    width: poster.info.width, height: poster.info.height, durationMs: Math.round(duration * 1000), bytes, mime: "application/vnd.apple.mpegurl",
  };
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    // No shell: arguments go straight to the program, so nothing in a file name or file can run as a command.
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    p.stdout.on("data", (d) => { if (stdout.length < 1e6) stdout += d; });
    p.stderr.on("data", (d) => { if (stderr.length < 1e5) stderr += d; });
    const timer = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
    p.on("error", (e) => { clearTimeout(timer); reject(e); });
    p.on("close", (code) => { clearTimeout(timer); code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-300)}`)); });
  });
}
