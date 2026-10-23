// Object storage over the S3 API (DECISIONS.md D14). SeaweedFS in Docker; any S3 (R2, AWS) works.
//
// Two buckets with different rules:
//   uploads  private. Browsers PUT originals here with a short-lived signed URL; only the API and
//            the worker can read them. Originals may carry EXIF/GPS, so they're never served.
//   media    public-read. Only the worker writes here, and only re-encoded files under random keys.
//            Caddy serves it at /media/... (path-style), so URLs look the same as before.
//
// Signed URLs are made for the PUBLIC address (APP_ORIGIN) because the browser sends the request.
// Caddy forwards /uploads/* to storage with the Host header untouched, so the signature (which
// covers host + path) still matches when storage checks it.
import {
  CreateBucketCommand, DeleteObjectsCommand, GetObjectCommand, HeadBucketCommand, HeadObjectCommand,
  ListObjectsV2Command, PutBucketPolicyCommand, PutObjectCommand, S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "../config.js";

const base = {
  region: config.S3_REGION,
  forcePathStyle: true, // bucket in the path (/media/key), not the hostname
  credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY },
  requestChecksumCalculation: "WHEN_REQUIRED" as const,
  responseChecksumValidation: "WHEN_REQUIRED" as const,
};
export const s3 = new S3Client({ ...base, endpoint: config.S3_ENDPOINT });
const signer = new S3Client({ ...base, endpoint: config.S3_PUBLIC_ENDPOINT ?? config.S3_ENDPOINT });

export const BUCKETS = { uploads: config.S3_BUCKET_UPLOADS, media: config.S3_BUCKET_MEDIA } as const;

/** Creates the buckets if missing. Safe to call on every start (API, worker, tests). */
export async function ensureBuckets() {
  for (const b of Object.values(BUCKETS)) {
    try { await s3.send(new HeadBucketCommand({ Bucket: b })); }
    catch { await s3.send(new CreateBucketCommand({ Bucket: b })).catch((e) => { if (!/BucketAlready/.test(String(e?.name))) throw e; }); }
  }
  // Public read for processed media only. SeaweedFS grants this through its identity config
  // (see deploy/seaweedfs.sh); on AWS/R2/MinIO a bucket policy does it. Best effort for both.
  await s3.send(new PutBucketPolicyCommand({
    Bucket: BUCKETS.media,
    Policy: JSON.stringify({ Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: "*", Action: ["s3:GetObject"], Resource: [`arn:aws:s3:::${BUCKETS.media}/*`] }] }),
  })).catch(() => {});
}

/**
 * Signed PUT for one upload. Content-Type and Content-Length are part of the signature, so the
 * browser can't swap in a bigger file or different type than it declared. Expires in 10 minutes.
 */
export async function signUpload(key: string, contentType: string, size: number) {
  const url = await getSignedUrl(signer, new PutObjectCommand({ Bucket: BUCKETS.uploads, Key: key, ContentType: contentType, ContentLength: size }), {
    expiresIn: 600,
    signableHeaders: new Set(["content-type", "content-length"]),
  });
  return { url, method: "PUT" as const, headers: { "Content-Type": contentType } };
}

export async function head(bucket: string, key: string) {
  try {
    const r = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return { size: r.ContentLength ?? 0, contentType: r.ContentType ?? null };
  } catch { return null; }
}

/** First bytes of an object, for magic-number checks without downloading the whole file. */
export async function readHead(bucket: string, key: string, bytes = 4100) {
  const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key, Range: `bytes=0-${bytes - 1}` }));
  return Buffer.from(await r.Body!.transformToByteArray());
}

export async function read(bucket: string, key: string) {
  const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return Buffer.from(await r.Body!.transformToByteArray());
}

const TYPES: Record<string, string> = { webp: "image/webp", m3u8: "application/vnd.apple.mpegurl", ts: "video/mp2t", m4s: "video/iso.segment", mp4: "video/mp4" };

/** Public, immutable files: every key contains a fresh random id, so they can be cached forever. */
export async function putPublic(key: string, body: Buffer, opts: { cache?: string } = {}) {
  const ext = key.split(".").pop() ?? "";
  await s3.send(new PutObjectCommand({
    Bucket: BUCKETS.media, Key: key, Body: body, ContentType: TYPES[ext] ?? "application/octet-stream",
    CacheControl: opts.cache ?? "public, max-age=31536000, immutable",
  }));
}

/** Deletes every object under a prefix (e.g. all files of one media item). */
export async function removePrefix(bucket: string, prefix: string) {
  let token: string | undefined;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
    const objs = (r.Contents ?? []).map((o) => ({ Key: o.Key! }));
    if (objs.length) await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objs, Quiet: true } }));
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
}

/** Every object in a bucket (optionally under a prefix), a page at a time. */
export async function* listObjects(bucket: string, prefix = "") {
  let token: string | undefined;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
    for (const o of r.Contents ?? []) yield { key: o.Key!, modified: o.LastModified ?? new Date(0), size: o.Size ?? 0 };
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
}

/** Deletes one object and throws if storage refused (cleanup must know, to retry). */
export async function removeObjectOrThrow(bucket: string, key: string) {
  const r = await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: [{ Key: key }], Quiet: true } }));
  if (r.Errors?.length) throw new Error(`delete failed: ${r.Errors[0]!.Code}`);
}

/** Best effort: for paths where a leftover is caught later by the cleanup jobs. */
export const removeObject = (bucket: string, key: string) =>
  s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: [{ Key: key }], Quiet: true } })).catch(() => {});
