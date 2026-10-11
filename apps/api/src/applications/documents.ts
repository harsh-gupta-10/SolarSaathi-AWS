import { createHash } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Private application documents (ID, bill, bank proof). Policy: docs/security.md "Application document uploads".
export const DOCUMENT_CONTENT_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;
export type DocumentContentType = typeof DOCUMENT_CONTENT_TYPES[number];
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const DOCUMENT_URL_TTL_SECONDS = 300;
export const DOCUMENT_RETENTION_DAYS = 365;

const SIGNATURES: Record<DocumentContentType, number[]> = {
  "application/pdf": [0x25, 0x50, 0x44, 0x46, 0x2d],
  "image/jpeg": [0xff, 0xd8, 0xff],
  "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
};

/** True when the first bytes of an object match the declared type's file signature. */
export function matchesSignature(contentType: DocumentContentType, head: Uint8Array): boolean {
  const signature = SIGNATURES[contentType];
  return head.length >= signature.length && signature.every((byte, index) => head[index] === byte);
}

/**
 * Object keys never contain user-supplied names. The owner segment is a hash so a Cognito subject or other
 * identifier format can never break the key shape.
 */
export function documentObjectKey(ownerUserId: string, applicationId: string, documentId: string): string {
  const owner = createHash("sha256").update(ownerUserId).digest("hex").slice(0, 32);
  return `applications/${owner}/${applicationId}/${documentId}`;
}

export interface DocumentUploadTicket { url: string; method: "PUT"; headers: Record<string, string>; expiresAt: string }
export interface StoredObjectInfo { sizeBytes: number; contentType?: string; head: Uint8Array }

export interface ApplicationDocumentStore {
  uploadTicket(key: string, contentType: DocumentContentType, sizeBytes: number, now: Date): Promise<DocumentUploadTicket>;
  inspect(key: string): Promise<StoredObjectInfo | undefined>;
  downloadUrl(key: string, contentType: DocumentContentType): Promise<string>;
  delete(key: string): Promise<void>;
}

function notFound(error: unknown): boolean {
  const name = error instanceof Error ? error.name : "";
  const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
  return name === "NotFound" || name === "NoSuchKey" || status === 404;
}

export class S3ApplicationDocumentStore implements ApplicationDocumentStore {
  private readonly client: S3Client;
  constructor(private readonly bucket: string, region: string, client?: S3Client) {
    // WHEN_REQUIRED keeps the SDK from adding checksum headers the browser would then have to reproduce.
    this.client = client ?? new S3Client({ region, maxAttempts: 2, requestChecksumCalculation: "WHEN_REQUIRED",
      requestHandler: { connectionTimeout: 1_000, requestTimeout: 4_000 } });
  }

  async uploadTicket(key: string, contentType: DocumentContentType, sizeBytes: number, now: Date) {
    // content-type and content-length are signed, so S3 rejects a body of any other declared size or type.
    // Encryption comes from the bucket default (SSE-S3), so the browser sends no extra headers.
    const url = await getSignedUrl(this.client, new PutObjectCommand({ Bucket: this.bucket, Key: key,
      ContentType: contentType, ContentLength: sizeBytes }), {
      expiresIn: DOCUMENT_URL_TTL_SECONDS, signableHeaders: new Set(["content-type", "content-length"]) });
    return { url, method: "PUT" as const,
      headers: { "content-type": contentType },
      expiresAt: new Date(now.getTime() + DOCUMENT_URL_TTL_SECONDS * 1_000).toISOString() };
  }

  async inspect(key: string): Promise<StoredObjectInfo | undefined> {
    try {
      const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
        { abortSignal: AbortSignal.timeout(5_000) });
      const range = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: "bytes=0-15" }),
        { abortSignal: AbortSignal.timeout(5_000) });
      const bytes = range.Body ? await range.Body.transformToByteArray() : new Uint8Array();
      return { sizeBytes: head.ContentLength ?? 0, contentType: head.ContentType, head: bytes };
    } catch (error) {
      if (notFound(error)) return undefined;
      throw error;
    }
  }

  downloadUrl(key: string, contentType: DocumentContentType): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key,
      ResponseContentType: contentType, ResponseContentDisposition: "attachment" }), { expiresIn: DOCUMENT_URL_TTL_SECONDS });
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      { abortSignal: AbortSignal.timeout(5_000) });
  }
}
