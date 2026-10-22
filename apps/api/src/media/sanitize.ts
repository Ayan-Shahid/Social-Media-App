// Upload sanitization.
//
// We never trust the file name, the extension, or the Content-Type the browser sends.
//  1. Size limit while receiving (multer), and a single file per request.
//  2. Detect the real type from the file's first bytes ("magic numbers"). Only JPEG, PNG, WebP,
//     GIF, HEIC images and MP4 / MOV / WebM videos are accepted. Anything else (HTML, SVG, scripts,
//     executables renamed to .png, etc.) is rejected.
//  3. Re-encode: images are decoded and re-written as fresh WebP with sharp; videos are decoded and
//     re-written as fresh H.264 MP4 with ffmpeg. Whatever was hidden in the original (extra data
//     appended to the file, polyglots, metadata, GPS location) does not survive, because we only
//     keep the decoded pixels and audio.
//  4. Files are saved under random server-generated names, outside the web root, and served with
//     `X-Content-Type-Options: nosniff` and a fixed Content-Type, so a browser can't treat them as a page.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { fileTypeFromBuffer } from "file-type";
import { config } from "../config.js";
import { HttpError } from "../lib/http.js";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"]);
const VIDEO_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm"]);

export interface SanitizedMedia {
  kind: "image" | "video";
  fileName: string;
  posterFileName: string | null;
  mime: string;
  width: number;
  height: number;
  durationMs: number | null;
  bytes: number;
}

const reject = (msg: string) => new HttpError(415, msg);

export async function detectType(buf: Buffer) {
  const t = await fileTypeFromBuffer(buf);
  if (!t) return null;
  if (IMAGE_TYPES.has(t.mime)) return { kind: "image" as const, mime: t.mime };
  if (VIDEO_TYPES.has(t.mime)) return { kind: "video" as const, mime: t.mime };
  return null;
}

export async function sanitizeUpload(buf: Buffer, purpose: "post" | "avatar"): Promise<SanitizedMedia> {
  const type = await detectType(buf);
  if (!type) throw reject("Only photos (JPEG, PNG, WebP, GIF, HEIC) and videos (MP4, MOV, WebM) are allowed.");
  if (type.kind === "video" && purpose === "avatar") throw reject("Profile pictures must be photos.");
  const max = (type.kind === "image" ? config.MAX_IMAGE_MB : config.MAX_VIDEO_MB) * 1024 * 1024;
  if (buf.length > max) throw new HttpError(413, `File too large. Max ${type.kind === "image" ? config.MAX_IMAGE_MB : config.MAX_VIDEO_MB} MB.`);
  await fs.mkdir(config.MEDIA_DIR, { recursive: true });
  return type.kind === "image" ? reencodeImage(buf, purpose) : reencodeVideo(buf);
}

async function reencodeImage(buf: Buffer, purpose: "post" | "avatar"): Promise<SanitizedMedia> {
  let pipeline;
  try {
    // limitInputPixels guards against "decompression bombs" (tiny files that expand to huge images).
    pipeline = sharp(buf, { limitInputPixels: 50_000_000, failOn: "error", animated: false }).rotate();
    pipeline = purpose === "avatar"
      ? pipeline.resize(400, 400, { fit: "cover" })
      : pipeline.resize(1440, 1800, { fit: "inside", withoutEnlargement: true });
    // sharp drops all metadata (EXIF, GPS, comments) unless asked to keep it.
    const { data, info } = await pipeline.webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
    const fileName = `${randomUUID()}.webp`;
    await fs.writeFile(path.join(config.MEDIA_DIR, fileName), data, { flag: "wx" });
    return { kind: "image", fileName, posterFileName: null, mime: "image/webp", width: info.width, height: info.height, durationMs: null, bytes: data.length };
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw reject("This image couldn't be read. It may be damaged or not a real image.");
  }
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    // No shell: arguments are passed directly, so nothing in a file can be run as a command.
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    p.stdout.on("data", (d) => { if (stdout.length < 1e6) stdout += d; });
    p.stderr.on("data", (d) => { if (stderr.length < 1e5) stderr += d; });
    const timer = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
    p.on("error", (e) => { clearTimeout(timer); reject(e); });
    p.on("close", (code) => { clearTimeout(timer); code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-300)}`)); });
  });
}

async function reencodeVideo(buf: Buffer): Promise<SanitizedMedia> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "glimpse-"));
  const input = path.join(tmp, "input");
  const id = randomUUID();
  const fileName = `${id}.mp4`;
  const posterFileName = `${id}.webp`;
  const out = path.join(config.MEDIA_DIR, fileName);
  try {
    await fs.writeFile(input, buf);
    // 1. Probe: must contain a real video stream, within the length limit.
    let probe: { streams?: { codec_type?: string; width?: number; height?: number }[]; format?: { duration?: string } };
    try {
      const r = await run(config.FFPROBE_PATH, ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", input], 20_000);
      probe = JSON.parse(r.stdout);
    } catch { throw reject("This video couldn't be read. It may be damaged or not a real video."); }
    const v = probe.streams?.find((s) => s.codec_type === "video");
    const duration = Number(probe.format?.duration ?? 0);
    if (!v || !v.width || !v.height) throw reject("This file has no video in it.");
    if (!duration || duration > config.MAX_VIDEO_SECONDS) throw reject(`Videos can be up to ${config.MAX_VIDEO_SECONDS} seconds.`);
    // 2. Re-encode to a clean H.264/AAC MP4, max 1080p, all metadata and extra streams removed.
    try {
      await run(config.FFMPEG_PATH, [
        "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", input,
        "-map", "0:v:0", "-map", "0:a:0?", "-map_metadata", "-1", "-map_chapters", "-1", "-sn", "-dn",
        "-vf", "scale='min(1080,iw)':-2:force_original_aspect_ratio=decrease,format=yuv420p",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart", "-t", String(config.MAX_VIDEO_SECONDS), out,
      ], 180_000);
    } catch { throw reject("This video couldn't be processed."); }
    // 3. Poster image from the first second, also re-encoded.
    const posterRaw = path.join(tmp, "poster.png");
    await run(config.FFMPEG_PATH, ["-nostdin", "-loglevel", "error", "-y", "-ss", "0.5", "-i", out, "-frames:v", "1", posterRaw], 30_000)
      .catch(() => run(config.FFMPEG_PATH, ["-nostdin", "-loglevel", "error", "-y", "-i", out, "-frames:v", "1", posterRaw], 30_000));
    const poster = await sharp(posterRaw).webp({ quality: 80 }).toBuffer({ resolveWithObject: true });
    await fs.writeFile(path.join(config.MEDIA_DIR, posterFileName), poster.data);
    const stat = await fs.stat(out);
    return { kind: "video", fileName, posterFileName, mime: "video/mp4", width: poster.info.width, height: poster.info.height, durationMs: Math.round(duration * 1000), bytes: stat.size };
  } catch (e) {
    await fs.rm(out, { force: true });
    throw e;
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}
